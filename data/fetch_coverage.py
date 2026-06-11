"""Street View coverage pipeline.

Pulls a region's drivable road network with osmnx, samples points along the
roads, queries the Google Street View *metadata* endpoint (free, no quota
charge) for each point, and writes a GeoJSON FeatureCollection whose feature
properties match the API contract's CoverageSample.

Usage:
    python fetch_coverage.py --region madison --test          # small verification batch
    python fetch_coverage.py --region madison                 # full run
    python fetch_coverage.py --region madison --test --limit 300 --spacing 60

The API key is read from GOOGLE_MAPS_API_KEY in backend/.env (or data/.env).
It is never printed. Metadata responses are cached in cache/ so re-runs are
free; delete the cache file to force a refetch.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests
from dotenv import dotenv_values

from regions import REGIONS, RegionConfig

DATA_DIR = Path(__file__).resolve().parent
CACHE_DIR = DATA_DIR / "cache"
OUTPUT_DIR = DATA_DIR / "output"

METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
SEARCH_RADIUS_M = 50  # a point is a "gap" if no pano exists within this radius

# Statuses that mean "no imagery here" rather than "request failed"
NO_COVERAGE_STATUSES = {"ZERO_RESULTS", "NOT_FOUND"}


def load_api_key() -> str:
    for env_path in (DATA_DIR.parent / "backend" / ".env", DATA_DIR / ".env"):
        if env_path.exists():
            key = dotenv_values(env_path).get("GOOGLE_MAPS_API_KEY")
            if key:
                return key
    sys.exit("GOOGLE_MAPS_API_KEY not found in backend/.env or data/.env")


def sanitize(message: str, key: str) -> str:
    """Strip the API key from anything we might print (e.g. requests errors)."""
    return message.replace(key, "***")


# --- Road sampling ----------------------------------------------------------------


def sample_points(
    bbox: tuple[float, float, float, float], spacing_m: float
) -> list[tuple[float, float]]:
    """(lng, lat) points every `spacing_m` meters along drivable roads in bbox."""
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = CACHE_DIR / "osmnx"

    graph = ox.graph_from_bbox(bbox, network_type="drive")
    edges = ox.graph_to_gdfs(graph, nodes=False)
    edges_m = edges.to_crs(epsg=32616)  # UTM 16N: meters around Madison

    seen: set[tuple[float, float]] = set()
    points_m = []
    for geom in edges_m.geometry:
        length = geom.length
        n_steps = max(1, int(length // spacing_m))
        for i in range(n_steps + 1):
            points_m.append(geom.interpolate(min(i * spacing_m, length)))

    import geopandas as gpd

    pts = gpd.GeoSeries(points_m, crs=32616).to_crs(epsg=4326)
    result: list[tuple[float, float]] = []
    for p in pts:
        # ~10 m dedupe grid: collapses the two directed edges of each street
        cell = (round(p.x, 4), round(p.y, 4))
        if cell in seen:
            continue
        seen.add(cell)
        result.append((p.x, p.y))
    return result


# --- Metadata fetch with cache + rate limit ---------------------------------------


def cache_key(lng: float, lat: float) -> str:
    return f"{lat:.6f},{lng:.6f}"


def load_cache(path: Path) -> dict[str, dict]:
    cache: dict[str, dict] = {}
    if path.exists():
        with path.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    entry = json.loads(line)
                    cache[entry["k"]] = entry["v"]
    return cache


def fetch_metadata(
    session: requests.Session, key: str, lng: float, lat: float
) -> dict:
    params = {
        "location": f"{lat:.6f},{lng:.6f}",
        "radius": SEARCH_RADIUS_M,
        "key": key,
    }
    for attempt in range(4):
        try:
            resp = session.get(METADATA_URL, params=params, timeout=10)
            body = resp.json()
            status = body.get("status", "UNKNOWN_ERROR")
            if status == "REQUEST_DENIED":
                # Can be transient while billing/API enablement propagates across
                # Google's frontends — only fatal if every attempt is denied.
                if attempt == 3:
                    sys.exit(f"Street View API request denied: {body.get('error_message', 'check the API key / enabled APIs')}")
                time.sleep(2**attempt)
                continue
            if status in ("OVER_QUERY_LIMIT", "UNKNOWN_ERROR") or resp.status_code >= 500:
                time.sleep(2**attempt)
                continue
            return body
        except (requests.RequestException, ValueError) as exc:
            if attempt == 3:
                raise RuntimeError(sanitize(str(exc), key)) from None
            time.sleep(2**attempt)
    return {"status": "UNKNOWN_ERROR"}


def classify_source(copyright_text: str) -> str:
    return "google" if "google" in copyright_text.lower() else "unofficial"


# --- Main -------------------------------------------------------------------------


def run(region: RegionConfig, test: bool, spacing_m: float, limit: int | None, rps: float) -> None:
    bbox = region.test_bbox if test else region.bbox
    suffix = ".test" if test else ""

    print(f"Sampling roads in {region.name} bbox={bbox} every {spacing_m:.0f} m ...")
    points = sample_points(bbox, spacing_m)
    print(f"  {len(points):,} sample points after dedupe")

    if limit and len(points) > limit:
        step = len(points) / limit
        points = [points[int(i * step)] for i in range(limit)]
        print(f"  subsampled evenly to {len(points):,} points (--limit)")

    api_key = load_api_key()
    CACHE_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    cache_path = CACHE_DIR / f"metadata.{region.region_id}.jsonl"
    cache = load_cache(cache_path)
    print(f"  {len(cache):,} cached responses loaded")

    session = requests.Session()
    features = []
    counts = {"OK": 0, "ZERO_RESULTS": 0, "google": 0, "unofficial": 0, "fetched": 0, "cached": 0}
    min_interval = 1.0 / rps
    last_request = 0.0

    try:
        with cache_path.open("a", encoding="utf-8") as cache_file:
            for i, (lng, lat) in enumerate(points):
                k = cache_key(lng, lat)
                body = cache.get(k)
                if body is None:
                    wait = min_interval - (time.monotonic() - last_request)
                    if wait > 0:
                        time.sleep(wait)
                    last_request = time.monotonic()
                    body = fetch_metadata(session, api_key, lng, lat)
                    cache_file.write(json.dumps({"k": k, "v": body}) + "\n")
                    counts["fetched"] += 1
                else:
                    counts["cached"] += 1

                raw_status = body.get("status", "UNKNOWN_ERROR")
                if raw_status == "OK":
                    source = classify_source(body.get("copyright", ""))
                    loc = body.get("location", {})
                    pano_lng = loc.get("lng", lng)
                    pano_lat = loc.get("lat", lat)
                    props = {
                        "pano_id": body.get("pano_id", ""),
                        "lat": pano_lat,
                        "lng": pano_lng,
                        "date": body.get("date", ""),
                        "source": source,
                        "status": "OK",
                    }
                    counts["OK"] += 1
                    counts[source] += 1
                    geom_lng, geom_lat = pano_lng, pano_lat
                else:
                    # Contract only knows OK | ZERO_RESULTS; sample coords stand in
                    props = {
                        "pano_id": "",
                        "lat": lat,
                        "lng": lng,
                        "date": "",
                        "source": "google",
                        "status": "ZERO_RESULTS",
                    }
                    counts["ZERO_RESULTS"] += 1
                    geom_lng, geom_lat = lng, lat

                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [round(geom_lng, 6), round(geom_lat, 6)]},
                        "properties": props,
                    }
                )

                if (i + 1) % 100 == 0:
                    print(f"  {i + 1:,}/{len(points):,} points ({counts['fetched']:,} fetched, {counts['cached']:,} cached)")
    except KeyboardInterrupt:
        print("\nInterrupted — cached responses are kept; re-run to resume.")
        raise SystemExit(130) from None

    out_path = OUTPUT_DIR / f"coverage.{region.region_id}{suffix}.geojson"
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8"
    )

    total = len(features)
    ok_pct = 100 * counts["OK"] / total if total else 0
    print(f"\nWrote {total:,} features to {out_path.relative_to(DATA_DIR)}")
    print(f"  OK: {counts['OK']:,} ({ok_pct:.1f}%)   ZERO_RESULTS: {counts['ZERO_RESULTS']:,}")
    print(f"  google: {counts['google']:,}   unofficial: {counts['unofficial']:,}")
    print(f"  requests made: {counts['fetched']:,}   served from cache: {counts['cached']:,}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Street View coverage metadata for a region.")
    parser.add_argument("--region", required=True, choices=sorted(REGIONS), help="Region id")
    parser.add_argument("--test", action="store_true", help="Use the small test bbox")
    parser.add_argument("--spacing", type=float, default=50.0, help="Sample spacing along roads, meters")
    parser.add_argument("--limit", type=int, default=None, help="Cap point count (even subsample)")
    parser.add_argument("--rps", type=float, default=10.0, help="Max metadata requests per second")
    args = parser.parse_args()

    run(REGIONS[args.region], args.test, args.spacing, args.limit, args.rps)


if __name__ == "__main__":
    main()
