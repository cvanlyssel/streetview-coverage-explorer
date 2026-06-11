"""Street View coverage pipeline.

Pulls a region's drivable road network with osmnx, samples points along the
roads, queries the Google Street View *metadata* endpoint (free, no quota
charge) for each point, and writes a GeoJSON FeatureCollection whose feature
properties match the API contract's CoverageSample.

Usage:
    python fetch_coverage.py --region madison --test          # small verification batch
    python fetch_coverage.py --region madison                 # full run
    python fetch_coverage.py --region wisconsin --sample-only # build/count points, no requests
    python fetch_coverage.py --region wisconsin --rps 50      # statewide fetch

The fetch stage is async (aiohttp): a shared pacer spaces request starts at
--rps (default 50, hard cap 100) across a worker pool, each request retries
with exponential backoff + jitter, and sustained throttling (429 /
OVER_QUERY_LIMIT) halves the rate at most once per 30 s.

The API key is read from GOOGLE_MAPS_API_KEY in backend/.env (or data/.env).
It is never printed. Metadata responses are cached in cache/ as JSONL
({"k": "lat,lng", "v": <response body>}, append-only) so interrupted runs
resume for free; delete the cache file to force a refetch. Failed requests
(exhausted retries) are NOT cached, so a re-run retries exactly those points.

Regions defined with `counties` (e.g. wisconsin) build their road network one
county at a time to keep osmnx memory bounded; per-county sample points are
cached under cache/points/<region>/. Output GeoJSON is streamed to disk, so
multi-million-point regions never hold features in memory.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
import time
from pathlib import Path

import aiohttp
from dotenv import dotenv_values

from regions import REGIONS, RegionConfig

DATA_DIR = Path(__file__).resolve().parent
CACHE_DIR = DATA_DIR / "cache"
OUTPUT_DIR = DATA_DIR / "output"
POINTS_DIR = CACHE_DIR / "points"

METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
SEARCH_RADIUS_M = 50  # a point is a "gap" if no pano exists within this radius
MAX_RPS = 100.0
MAX_ATTEMPTS = 5
THROTTLE_COOLDOWN_S = 30.0
PROGRESS_INTERVAL_S = 15.0

# Statuses that mean "no imagery here" rather than "request failed"
NO_COVERAGE_STATUSES = {"ZERO_RESULTS", "NOT_FOUND"}
TRANSIENT_STATUSES = {"OVER_QUERY_LIMIT", "UNKNOWN_ERROR"}


class FatalFetchError(RuntimeError):
    """Unrecoverable API error (e.g. REQUEST_DENIED on every attempt)."""


def load_api_key() -> str:
    for env_path in (DATA_DIR.parent / "backend" / ".env", DATA_DIR / ".env"):
        if env_path.exists():
            key = dotenv_values(env_path).get("GOOGLE_MAPS_API_KEY")
            if key:
                return key
    sys.exit("GOOGLE_MAPS_API_KEY not found in backend/.env or data/.env")


def sanitize(message: str, key: str) -> str:
    """Strip the API key from anything we might print (e.g. aiohttp errors)."""
    return message.replace(key, "***")


# --- Road sampling ----------------------------------------------------------------


def _interpolated_points(graph, spacing_m: float, metric_epsg: int) -> list:
    """Shapely points every `spacing_m` meters along the graph's edges, in WGS84."""
    import geopandas as gpd
    import osmnx as ox

    edges = ox.graph_to_gdfs(graph, nodes=False)
    edges_m = edges.to_crs(epsg=metric_epsg)

    points_m = []
    for geom in edges_m.geometry:
        length = geom.length
        n_steps = max(1, int(length // spacing_m))
        for i in range(n_steps + 1):
            points_m.append(geom.interpolate(min(i * spacing_m, length)))

    return list(gpd.GeoSeries(points_m, crs=metric_epsg).to_crs(epsg=4326))


def sample_points(
    bbox: tuple[float, float, float, float], spacing_m: float
) -> list[tuple[float, float]]:
    """(lng, lat) points every `spacing_m` meters along drivable roads in bbox."""
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = CACHE_DIR / "osmnx"

    graph = ox.graph_from_bbox(bbox, network_type="drive")
    pts = _interpolated_points(graph, spacing_m, metric_epsg=32616)

    seen: set[tuple[float, float]] = set()
    result: list[tuple[float, float]] = []
    for p in pts:
        # ~10 m dedupe grid: collapses the two directed edges of each street
        cell = (round(p.x, 4), round(p.y, 4))
        if cell in seen:
            continue
        seen.add(cell)
        result.append((p.x, p.y))
    return result


def _grid_key(lng: float, lat: float) -> int:
    """The ~10 m dedupe cell as one packed int (cheap to hold millions of)."""
    return int(round(lng * 10_000)) * 4_000_000 + int(round(lat * 10_000))


def sample_points_by_county(
    region: RegionConfig, spacing_m: float
) -> list[tuple[float, float]]:
    """County-at-a-time sampling for statewide regions.

    Each county's drivable graph is built, sampled, and released before the
    next download, and the resulting points are cached as JSON so re-runs
    skip straight to the merge. Dedupe runs on the same ~10 m grid as the
    bbox path but globally, so roads on county lines aren't double-counted.
    """
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = CACHE_DIR / "osmnx"

    points_dir = POINTS_DIR / region.region_id
    points_dir.mkdir(parents=True, exist_ok=True)

    seen: set[int] = set()
    result: list[tuple[float, float]] = []
    for i, county in enumerate(region.counties):
        slug = county.split(",")[0].lower().replace(" ", "-").replace(".", "")
        county_path = points_dir / f"{slug}.json"
        if county_path.exists():
            pts = json.loads(county_path.read_text(encoding="utf-8"))
        else:
            t0 = time.monotonic()
            graph = ox.graph_from_place(county, network_type="drive")
            raw = _interpolated_points(graph, spacing_m, region.metric_epsg)
            del graph
            pts = [(p.x, p.y) for p in raw]
            del raw
            county_path.write_text(json.dumps(pts), encoding="utf-8")
            print(
                f"  [{i + 1}/{len(region.counties)}] {county.split(',')[0]}: "
                f"{len(pts):,} raw points in {time.monotonic() - t0:.0f}s",
                flush=True,
            )

        for lng, lat in pts:
            cell = _grid_key(lng, lat)
            if cell in seen:
                continue
            seen.add(cell)
            result.append((lng, lat))
    return result


# --- Metadata fetch: async, rate-limited, cached ----------------------------------


def cache_key(lng: float, lat: float) -> str:
    return f"{lat:.6f},{lng:.6f}"


def load_cache_keys(path: Path) -> set[str]:
    """Only the keys — full bodies stay on disk so statewide caches fit in RAM."""
    keys: set[str] = set()
    if path.exists():
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    keys.add(json.loads(line)["k"])
                except (json.JSONDecodeError, KeyError):
                    continue  # truncated tail from an interrupted run
    return keys


class RateController:
    """Spaces request starts to a target rate shared by all workers.

    `throttle()` halves the rate (floor 1 rps), at most once per cooldown
    window so a burst of 429s doesn't collapse the rate to the floor.
    """

    def __init__(self, rps: float) -> None:
        self.interval = 1.0 / rps
        self.halvings = 0
        self._next_start = 0.0
        self._lock = asyncio.Lock()
        self._last_halved = 0.0

    @property
    def rps(self) -> float:
        return 1.0 / self.interval

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self._next_start = max(self._next_start, now)
            delay = self._next_start - now
            self._next_start += self.interval
        if delay > 0:
            await asyncio.sleep(delay)

    def throttle(self) -> bool:
        now = time.monotonic()
        if now - self._last_halved < THROTTLE_COOLDOWN_S or self.interval >= 1.0:
            return False
        self.interval = min(self.interval * 2, 1.0)
        self._last_halved = now
        self.halvings += 1
        return True


async def fetch_one(
    session: aiohttp.ClientSession,
    api_key: str,
    rate: RateController,
    lng: float,
    lat: float,
    counts: dict[str, int],
) -> dict | None:
    """One metadata lookup with backoff. None = gave up (left uncached)."""
    params = {
        "location": f"{lat:.6f},{lng:.6f}",
        "radius": str(SEARCH_RADIUS_M),
        "key": api_key,
    }
    for attempt in range(MAX_ATTEMPTS):
        await rate.acquire()
        body: dict | None = None
        try:
            async with session.get(METADATA_URL, params=params) as resp:
                if resp.status == 429 or resp.status >= 500:
                    counts["throttle_signals" if resp.status == 429 else "http_5xx"] += 1
                    if resp.status == 429 and rate.throttle():
                        print(f"\n[rate] HTTP 429 — halving to {rate.rps:.0f} rps", flush=True)
                else:
                    body = await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
            counts["network_errors"] += 1
            if attempt == MAX_ATTEMPTS - 1:
                print(f"\n[error] {sanitize(repr(exc), api_key)}", flush=True)

        if body is not None:
            status = body.get("status", "UNKNOWN_ERROR")
            if status == "REQUEST_DENIED":
                # Can be transient while billing/API enablement propagates across
                # Google's frontends — only fatal if every attempt is denied.
                if attempt == MAX_ATTEMPTS - 1:
                    raise FatalFetchError(
                        "Street View API request denied: "
                        f"{body.get('error_message', 'check the API key / enabled APIs')}"
                    )
            elif status in TRANSIENT_STATUSES:
                counts["throttle_signals"] += 1
                if status == "OVER_QUERY_LIMIT" and rate.throttle():
                    print(f"\n[rate] OVER_QUERY_LIMIT — halving to {rate.rps:.0f} rps", flush=True)
            else:
                return body

        await asyncio.sleep(2**attempt + random.random())

    counts["failed"] += 1
    return None


async def fetch_missing(
    missing: list[tuple[float, float]],
    api_key: str,
    rps: float,
    cache_path: Path,
    counts: dict[str, int],
) -> None:
    rate = RateController(rps)
    n_workers = min(100, max(8, int(rps)))
    queue: asyncio.Queue[tuple[float, float] | None] = asyncio.Queue(maxsize=1000)
    write_lock = asyncio.Lock()
    total = len(missing)
    started = time.monotonic()

    async def worker(cache_file) -> None:
        while True:
            item = await queue.get()
            if item is None:
                return
            lng, lat = item
            body = await fetch_one(session, api_key, rate, lng, lat, counts)
            if body is not None:
                line = json.dumps({"k": cache_key(lng, lat), "v": body})
                async with write_lock:
                    cache_file.write(line + "\n")
                    cache_file.flush()  # every line: a killed run loses nothing
                    counts["fetched"] += 1

    async def reporter() -> None:
        last_done, last_t = 0, time.monotonic()
        while True:
            await asyncio.sleep(PROGRESS_INTERVAL_S)
            done = counts["fetched"] + counts["failed"]
            now = time.monotonic()
            window_rps = (done - last_done) / (now - last_t)
            last_done, last_t = done, now
            remaining = total - done
            eta_h = remaining / window_rps / 3600 if window_rps > 0 else float("inf")
            print(
                f"  {done:,}/{total:,} ({window_rps:.1f} req/s, target {rate.rps:.0f}) "
                f"failed={counts['failed']:,} throttle_signals={counts['throttle_signals']:,} "
                f"ETA {eta_h:.1f}h",
                flush=True,
            )

    timeout = aiohttp.ClientTimeout(total=30)
    connector = aiohttp.TCPConnector(limit=n_workers)
    print(f"Fetching {total:,} points at {rps:.0f} rps with {n_workers} workers ...", flush=True)
    with cache_path.open("a", encoding="utf-8") as cache_file:
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            workers = [asyncio.create_task(worker(cache_file)) for _ in range(n_workers)]
            report_task = asyncio.create_task(reporter())
            try:
                for point in missing:
                    await queue.put(point)
                for _ in workers:
                    await queue.put(None)
                await asyncio.gather(*workers)
            finally:
                report_task.cancel()
                for w in workers:
                    w.cancel()

    elapsed = time.monotonic() - started
    print(
        f"Fetch stage done in {elapsed / 3600:.2f}h: {counts['fetched']:,} cached, "
        f"{counts['failed']:,} failed (uncached; re-run retries them), "
        f"rate halved {rate.halvings}x (final {rate.rps:.0f} rps)",
        flush=True,
    )


def classify_source(copyright_text: str) -> str:
    return "google" if "google" in copyright_text.lower() else "unofficial"


# --- Output (streamed) -------------------------------------------------------------


def build_feature(key: str, body: dict, counts: dict[str, int]) -> dict:
    sample_lat, sample_lng = (float(v) for v in key.split(","))
    raw_status = body.get("status", "UNKNOWN_ERROR")
    if raw_status == "OK":
        source = classify_source(body.get("copyright", ""))
        loc = body.get("location", {})
        lng = loc.get("lng", sample_lng)
        lat = loc.get("lat", sample_lat)
        props = {
            "pano_id": body.get("pano_id", ""),
            "lat": lat,
            "lng": lng,
            "date": body.get("date", ""),
            "source": source,
            "status": "OK",
        }
        counts["OK"] += 1
        counts[source] += 1
    else:
        # Contract only knows OK | ZERO_RESULTS; sample coords stand in
        lng, lat = sample_lng, sample_lat
        props = {
            "pano_id": "",
            "lat": lat,
            "lng": lng,
            "date": "",
            "source": "google",
            "status": "ZERO_RESULTS",
        }
        counts["ZERO_RESULTS"] += 1
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
        "properties": props,
    }


def write_output(
    points: list[tuple[float, float]], cache_path: Path, out_path: Path
) -> dict[str, int]:
    """Stream cache lines -> GeoJSON features for this run's points."""
    wanted = {cache_key(lng, lat) for lng, lat in points}
    counts = {"OK": 0, "ZERO_RESULTS": 0, "google": 0, "unofficial": 0}

    with cache_path.open(encoding="utf-8") as cache_file, out_path.open(
        "w", encoding="utf-8"
    ) as out:
        out.write('{"type": "FeatureCollection", "features": [\n')
        first = True
        for line in cache_file:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                key = entry["k"]
            except (json.JSONDecodeError, KeyError):
                continue
            if key not in wanted:
                continue
            wanted.discard(key)  # also collapses duplicate cache lines
            feature = build_feature(key, entry["v"], counts)
            out.write(("" if first else ",\n") + json.dumps(feature))
            first = False
        out.write("\n]}\n")

    counts["missing"] = len(wanted)
    return counts


# --- Main -------------------------------------------------------------------------


def run(
    region: RegionConfig,
    test: bool,
    spacing_m: float,
    limit: int | None,
    rps: float,
    sample_only: bool,
) -> None:
    suffix = ".test" if test else ""

    if region.counties and not test:
        print(
            f"Sampling roads in {region.name} across {len(region.counties)} counties "
            f"every {spacing_m:.0f} m ...",
            flush=True,
        )
        points = sample_points_by_county(region, spacing_m)
    else:
        bbox = region.test_bbox if test else region.bbox
        print(f"Sampling roads in {region.name} bbox={bbox} every {spacing_m:.0f} m ...")
        points = sample_points(bbox, spacing_m)
    print(f"  {len(points):,} sample points after dedupe", flush=True)

    if sample_only:
        print("--sample-only: stopping before any API requests.")
        return

    if limit and len(points) > limit:
        step = len(points) / limit
        points = [points[int(i * step)] for i in range(limit)]
        print(f"  subsampled evenly to {len(points):,} points (--limit)")

    CACHE_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    cache_path = CACHE_DIR / f"metadata.{region.region_id}.jsonl"
    cached_keys = load_cache_keys(cache_path)
    missing = [p for p in points if cache_key(*p) not in cached_keys]
    print(
        f"  {len(points) - len(missing):,} already cached, {len(missing):,} to fetch",
        flush=True,
    )

    fetch_counts = {
        "fetched": 0,
        "failed": 0,
        "throttle_signals": 0,
        "http_5xx": 0,
        "network_errors": 0,
    }
    if missing:
        api_key = load_api_key()
        try:
            asyncio.run(fetch_missing(missing, api_key, rps, cache_path, fetch_counts))
        except KeyboardInterrupt:
            print("\nInterrupted — cached responses are kept; re-run to resume.")
            raise SystemExit(130) from None
        except FatalFetchError as exc:
            sys.exit(str(exc))

    out_path = OUTPUT_DIR / f"coverage.{region.region_id}{suffix}.geojson"
    counts = write_output(points, cache_path, out_path)

    total = counts["OK"] + counts["ZERO_RESULTS"]
    ok_pct = 100 * counts["OK"] / total if total else 0
    print(f"\nWrote {total:,} features to {out_path.relative_to(DATA_DIR)}")
    print(f"  OK: {counts['OK']:,} ({ok_pct:.1f}%)   ZERO_RESULTS: {counts['ZERO_RESULTS']:,}")
    print(f"  google: {counts['google']:,}   unofficial: {counts['unofficial']:,}")
    print(
        f"  requests made: {fetch_counts['fetched']:,}   "
        f"served from cache: {len(points) - len(missing):,}"
    )
    if counts["missing"]:
        print(
            f"  WARNING: {counts['missing']:,} points have no cached response "
            "(failed requests) — re-run to retry them."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Street View coverage metadata for a region.")
    parser.add_argument("--region", required=True, choices=sorted(REGIONS), help="Region id")
    parser.add_argument("--test", action="store_true", help="Use the small test bbox")
    parser.add_argument("--spacing", type=float, default=50.0, help="Sample spacing along roads, meters")
    parser.add_argument("--limit", type=int, default=None, help="Cap point count (even subsample)")
    parser.add_argument("--rps", type=float, default=50.0, help=f"Max metadata requests per second (cap {MAX_RPS:.0f})")
    parser.add_argument("--sample-only", action="store_true", help="Sample + count points, make no API requests")
    args = parser.parse_args()

    if args.rps > MAX_RPS:
        parser.error(f"--rps capped at {MAX_RPS:.0f}")
    if args.rps <= 0:
        parser.error("--rps must be positive")

    run(REGIONS[args.region], args.test, args.spacing, args.limit, args.rps, args.sample_only)


if __name__ == "__main__":
    main()
