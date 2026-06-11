"""Load a coverage GeoJSON (from fetch_coverage.py) into PostGIS.

Usage:
    python load_postgis.py --region madison --file output/coverage.madison.geojson

Reads DATABASE_URL from backend/.env (or data/.env). Replaces the region's rows in
coverage_samples, then derives everything the API serves:

  - coverage_samples.nearest_road for ZERO_RESULTS rows (osmnx nearest-edge join)
  - coverage_hexbins: H3 aggregates (count, density, age, ratio)
  - regions: one row per region with bbox, point_count, last_updated

Built to scale to statewide files (millions of features): the GeoJSON is
streamed (two passes — gaps first for road naming, then inserts + hexbin
accumulation), samples go in by batch, and statewide regions cap hexbins at
resolutions 7-8 (res 9-10 over a whole state is millions of cells no client
should ever request).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Iterator

import h3
import psycopg2
import psycopg2.extras
from dotenv import dotenv_values

from regions import REGIONS, RegionConfig

DATA_DIR = Path(__file__).resolve().parent

CITY_HEX_RESOLUTIONS = (7, 8, 9, 10)
STATEWIDE_HEX_RESOLUTIONS = (7, 8)
GAP_ROAD_MAX_DISTANCE_M = 200
INSERT_BATCH = 5_000

DDL = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS coverage_samples (
    id           BIGSERIAL PRIMARY KEY,
    region       TEXT NOT NULL,
    pano_id      TEXT,
    date         TEXT,
    source       TEXT NOT NULL CHECK (source IN ('google', 'unofficial')),
    status       TEXT NOT NULL CHECK (status IN ('OK', 'ZERO_RESULTS')),
    nearest_road TEXT,
    geom         GEOMETRY(POINT, 4326) NOT NULL
);
ALTER TABLE coverage_samples ADD COLUMN IF NOT EXISTS nearest_road TEXT;
CREATE INDEX IF NOT EXISTS coverage_samples_region_idx ON coverage_samples (region);
CREATE INDEX IF NOT EXISTS coverage_samples_geom_idx ON coverage_samples USING GIST (geom);

CREATE TABLE IF NOT EXISTS coverage_hexbins (
    region           TEXT NOT NULL,
    resolution       INT  NOT NULL,
    hex_id           TEXT NOT NULL,
    coverage_count   INT  NOT NULL,
    coverage_density REAL NOT NULL,
    avg_age_years    REAL NOT NULL,
    oldest_date      TEXT NOT NULL,
    newest_date      TEXT NOT NULL,
    official_ratio   REAL NOT NULL,
    geom             GEOMETRY(POLYGON, 4326) NOT NULL,
    PRIMARY KEY (region, resolution, hex_id)
);

CREATE TABLE IF NOT EXISTS regions (
    region_id    TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    west         DOUBLE PRECISION NOT NULL,
    south        DOUBLE PRECISION NOT NULL,
    east         DOUBLE PRECISION NOT NULL,
    north        DOUBLE PRECISION NOT NULL,
    point_count  INT NOT NULL,
    last_updated DATE NOT NULL
);
"""


def load_database_url() -> str:
    """Env var, then data/.env, then backend/.env.

    data/.env outranks backend/.env here (unlike the API) so the deploy flow
    in docs/DEPLOYMENT_PLAN.md works: production's external URL goes in
    data/.env while backend/.env keeps pointing dev at the local DB.
    """
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for env_path in (DATA_DIR / ".env", DATA_DIR.parent / "backend" / ".env"):
        if env_path.exists():
            url = dotenv_values(env_path).get("DATABASE_URL")
            if url:
                return url
    sys.exit("DATABASE_URL not found in environment, data/.env, or backend/.env")


def iter_features(path: Path) -> Iterator[dict]:
    """Stream features without holding the file in memory.

    fetch_coverage.py writes one feature per line (header line, then
    '<feature>,' lines, then ']}'); older files are a single-line dump and
    fall back to a whole-file parse.
    """
    with path.open(encoding="utf-8") as f:
        first = f.readline()
        if first.strip() == '{"type": "FeatureCollection", "features": [':
            for line in f:
                line = line.strip().rstrip(",")
                if not line or line in ("]}", "]"):
                    continue
                yield json.loads(line)
            return
    # Legacy single-line format (Madison/Milwaukee era files)
    yield from json.loads(path.read_text(encoding="utf-8"))["features"]


def age_years(date_str: str, today: date) -> float | None:
    """Years between a YYYY-MM pano date and today."""
    try:
        year, month = int(date_str[:4]), int(date_str[5:7])
    except (ValueError, IndexError):
        return None
    return max(0.0, (today.year - year) + (today.month - month) / 12)


def hex_wkt(hex_id: str) -> str:
    """Closed POLYGON WKT for an H3 cell (boundary comes back as lat/lng pairs)."""
    ring = [f"{lng} {lat}" for lat, lng in h3.cell_to_boundary(hex_id)]
    ring.append(ring[0])
    return f"POLYGON(({', '.join(ring)}))"


class HexAccumulator:
    """Streaming per-cell aggregates: no feature list ever materializes."""

    def __init__(self, resolutions: tuple[int, ...]) -> None:
        self.resolutions = resolutions
        # hex_id -> [count, age_sum, age_n, google_n, min_date, max_date]
        self.cells: dict[int, dict[str, list]] = {r: defaultdict(lambda: [0, 0.0, 0, 0, "", ""]) for r in resolutions}

    def add(self, props: dict, today: date) -> None:
        if props["status"] != "OK":
            return
        age = age_years(props["date"], today)
        d = props["date"]
        for res in self.resolutions:
            cell = self.cells[res][h3.latlng_to_cell(props["lat"], props["lng"], res)]
            cell[0] += 1
            if age is not None:
                cell[1] += age
                cell[2] += 1
            if props["source"] == "google":
                cell[3] += 1
            if d:
                cell[4] = min(cell[4] or d, d)
                cell[5] = max(cell[5], d)

    def rows(self, region_id: str) -> Iterator[tuple]:
        for res in self.resolutions:
            cells = self.cells[res]
            if not cells:
                continue
            max_count = max(c[0] for c in cells.values())
            for hex_id, (count, age_sum, age_n, google_n, dmin, dmax) in cells.items():
                yield (
                    region_id,
                    res,
                    hex_id,
                    count,
                    count / max_count,
                    round(age_sum / age_n, 2) if age_n else 0.0,
                    dmin,
                    dmax,
                    google_n / count,
                    hex_wkt(hex_id),
                )


def _names_from_edges(edges, gap_gdf) -> dict[int, str]:
    import geopandas as gpd

    joined = gpd.sjoin_nearest(
        gap_gdf, edges, how="left", max_distance=GAP_ROAD_MAX_DISTANCE_M
    )
    # sjoin_nearest can return several equally-near edges per point; keep the first
    joined = joined[~joined.index.duplicated(keep="first")]

    names: dict[int, str] = {}
    for _, row in joined.iterrows():
        name = row["name"]
        if isinstance(name, list):
            name = name[0] if name else None
        if isinstance(name, str) and name:
            names[int(row["idx"])] = name
    return names


def nearest_road_names(
    region: RegionConfig, gaps: list[tuple[int, float, float]]
) -> dict[int, str]:
    """Map gap sample index -> nearest drivable road name within 200 m.

    City regions: one bbox graph. Statewide regions: county by county against
    the osmnx disk cache, resolving only gaps inside each county's envelope.
    """
    import geopandas as gpd
    import osmnx as ox
    from shapely.geometry import Point

    ox.settings.use_cache = True
    ox.settings.cache_folder = DATA_DIR / "cache" / "osmnx"

    def gap_frame(subset: list[tuple[int, float, float]]):
        return gpd.GeoDataFrame(
            {"idx": [i for i, _, _ in subset]},
            geometry=[Point(lng, lat) for _, lng, lat in subset],
            crs=4326,
        ).to_crs(epsg=region.metric_epsg)

    if not region.counties:
        graph = ox.graph_from_bbox(region.bbox, network_type="drive")
        edges = ox.graph_to_gdfs(graph, nodes=False)[["name", "geometry"]].to_crs(
            epsg=region.metric_epsg
        )
        return _names_from_edges(edges, gap_frame(gaps))

    names: dict[int, str] = {}
    unresolved = gaps
    for n, county in enumerate(region.counties):
        if not unresolved:
            break
        graph = ox.graph_from_place(county, network_type="drive")
        edges = ox.graph_to_gdfs(graph, nodes=False)[["name", "geometry"]]
        del graph
        west, south, east, north = edges.total_bounds
        local = [
            g
            for g in unresolved
            if west - 0.01 <= g[1] <= east + 0.01 and south - 0.01 <= g[2] <= north + 0.01
        ]
        if local:
            names.update(
                _names_from_edges(edges.to_crs(epsg=region.metric_epsg), gap_frame(local))
            )
            unresolved = [g for g in unresolved if g[0] not in names]
        print(
            f"  [{n + 1}/{len(region.counties)}] {county.split(',')[0]}: "
            f"{len(names):,} named, {len(unresolved):,} left",
            flush=True,
        )
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description="Load coverage GeoJSON into PostGIS.")
    parser.add_argument("--region", required=True, choices=sorted(REGIONS), help="Region id")
    parser.add_argument("--file", required=True, help="GeoJSON path from fetch_coverage.py")
    parser.add_argument(
        "--skip-road-names",
        action="store_true",
        help="Skip the osmnx nearest-road join for gaps (API falls back to 'Unnamed road')",
    )
    args = parser.parse_args()
    region = REGIONS[args.region]
    today = date.today()
    resolutions = STATEWIDE_HEX_RESOLUTIONS if region.counties else CITY_HEX_RESOLUTIONS

    geojson_path = Path(args.file)
    if not geojson_path.is_absolute():
        geojson_path = DATA_DIR / geojson_path

    # Pass 1: gap coordinates only (cheap), so names exist before the insert.
    gaps = [
        (i, f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1])
        for i, f in enumerate(iter_features(geojson_path))
        if f["properties"]["status"] == "ZERO_RESULTS"
    ]
    gap_names: dict[int, str] = {}
    if gaps and not args.skip_road_names:
        print(f"Resolving road names for {len(gaps):,} gap points ...")
        gap_names = nearest_road_names(region, gaps)

    # keepalives: remote (Render) loads stream for minutes; idle gaps during
    # local hexbin WKT generation otherwise let middleboxes drop the TLS link.
    # TLS capped at 1.2: sustained bulk writes from Windows OpenSSL over
    # TLS 1.3 die with "ssl/tls alert bad record mac" (seen twice mid-insert).
    conn = psycopg2.connect(
        load_database_url(),
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
        ssl_max_protocol_version="TLSv1.2",
    )
    accum = HexAccumulator(resolutions)
    total = 0
    try:
        with conn, conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute("DELETE FROM coverage_samples WHERE region = %s", (args.region,))

            # Pass 2: stream inserts + hexbin accumulation in one walk.
            batch: list[tuple] = []

            def flush() -> None:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO coverage_samples
                        (region, pano_id, date, source, status, nearest_road, geom)
                    VALUES %s
                    """,
                    batch,
                    template="(%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                    page_size=200,  # smaller TLS records: see connect() note
                )
                batch.clear()

            for i, f in enumerate(iter_features(geojson_path)):
                p = f["properties"]
                accum.add(p, today)
                batch.append(
                    (
                        args.region,
                        p["pano_id"] or None,
                        p["date"] or None,
                        p["source"],
                        p["status"],
                        gap_names.get(i),
                        f["geometry"]["coordinates"][0],
                        f["geometry"]["coordinates"][1],
                    )
                )
                total += 1
                if len(batch) >= INSERT_BATCH:
                    flush()
                    if total % 500_000 == 0:
                        print(f"  {total:,} samples inserted ...", flush=True)
            if batch:
                flush()
            print(f"Inserted {total:,} samples; writing hexbins at {resolutions} ...")

            cur.execute("DELETE FROM coverage_hexbins WHERE region = %s", (args.region,))
            hex_batch: list[tuple] = []
            hex_total = 0
            for row in accum.rows(args.region):
                hex_batch.append(row)
                hex_total += 1
                if len(hex_batch) >= 2_000:
                    psycopg2.extras.execute_values(
                        cur,
                        """
                        INSERT INTO coverage_hexbins
                            (region, resolution, hex_id, coverage_count, coverage_density,
                             avg_age_years, oldest_date, newest_date, official_ratio, geom)
                        VALUES %s
                        """,
                        hex_batch,
                        template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326))",
                        page_size=500,
                    )
                    hex_batch.clear()
            if hex_batch:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO coverage_hexbins
                        (region, resolution, hex_id, coverage_count, coverage_density,
                         avg_age_years, oldest_date, newest_date, official_ratio, geom)
                    VALUES %s
                    """,
                    hex_batch,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326))",
                    page_size=500,
                )

            cur.execute(
                """
                INSERT INTO regions
                    (region_id, name, west, south, east, north, point_count, last_updated)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (region_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    west = EXCLUDED.west, south = EXCLUDED.south,
                    east = EXCLUDED.east, north = EXCLUDED.north,
                    point_count = EXCLUDED.point_count,
                    last_updated = EXCLUDED.last_updated
                """,
                (args.region, region.name, *region.bbox, total, today),
            )

            cur.execute(
                "SELECT count(*) FROM coverage_samples WHERE region = %s", (args.region,)
            )
            print(f"coverage_samples: {cur.fetchone()[0]:,} rows for region={args.region}")
            cur.execute(
                """
                SELECT resolution, count(*) FROM coverage_hexbins
                WHERE region = %s GROUP BY resolution ORDER BY resolution
                """,
                (args.region,),
            )
            for res, n in cur.fetchall():
                print(f"coverage_hexbins res {res}: {n:,} cells")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
