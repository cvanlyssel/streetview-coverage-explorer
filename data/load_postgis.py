"""Load a coverage GeoJSON (from fetch_coverage.py) into PostGIS.

Usage:
    python load_postgis.py --region madison --file output/coverage.madison.geojson

Reads DATABASE_URL from backend/.env (or data/.env). Replaces the region's rows in
coverage_samples, then derives everything the API serves:

  - coverage_samples.nearest_road for ZERO_RESULTS rows (osmnx nearest-edge join)
  - coverage_hexbins: H3 aggregates at resolutions 7-10 (count, density, age, ratio)
  - regions: one row per region with bbox, point_count, last_updated
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import h3
import psycopg2
import psycopg2.extras
from dotenv import dotenv_values

from regions import REGIONS

DATA_DIR = Path(__file__).resolve().parent

HEX_RESOLUTIONS = (7, 8, 9, 10)
GAP_ROAD_MAX_DISTANCE_M = 200

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
    for env_path in (DATA_DIR.parent / "backend" / ".env", DATA_DIR / ".env"):
        if env_path.exists():
            url = dotenv_values(env_path).get("DATABASE_URL")
            if url:
                return url
    sys.exit("DATABASE_URL not found in backend/.env or data/.env")


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


def build_hexbin_rows(region_id: str, features: list[dict], today: date) -> list[tuple]:
    """Aggregate OK samples into H3 cells at each resolution, contract-shaped."""
    rows: list[tuple] = []
    for resolution in HEX_RESOLUTIONS:
        cells: dict[str, list[dict]] = defaultdict(list)
        for f in features:
            p = f["properties"]
            if p["status"] != "OK":
                continue
            cells[h3.latlng_to_cell(p["lat"], p["lng"], resolution)].append(p)

        if not cells:
            continue
        max_count = max(len(samples) for samples in cells.values())
        for hex_id, samples in cells.items():
            ages = [a for p in samples if (a := age_years(p["date"], today)) is not None]
            dates = [p["date"] for p in samples if p["date"]]
            rows.append(
                (
                    region_id,
                    resolution,
                    hex_id,
                    len(samples),
                    len(samples) / max_count,
                    round(sum(ages) / len(ages), 2) if ages else 0.0,
                    min(dates) if dates else "",
                    max(dates) if dates else "",
                    sum(1 for p in samples if p["source"] == "google") / len(samples),
                    hex_wkt(hex_id),
                )
            )
    return rows


def nearest_road_names(
    region_id: str, gaps: list[tuple[int, float, float]]
) -> dict[int, str]:
    """Map gap sample index -> nearest drivable road name within 200 m."""
    import geopandas as gpd
    import osmnx as ox
    from shapely.geometry import Point

    ox.settings.use_cache = True
    ox.settings.cache_folder = DATA_DIR / "cache" / "osmnx"

    graph = ox.graph_from_bbox(REGIONS[region_id].bbox, network_type="drive")
    edges = ox.graph_to_gdfs(graph, nodes=False)[["name", "geometry"]].to_crs(epsg=32616)

    gap_gdf = gpd.GeoDataFrame(
        {"idx": [i for i, _, _ in gaps]},
        geometry=[Point(lng, lat) for _, lng, lat in gaps],
        crs=4326,
    ).to_crs(epsg=32616)

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
        names[int(row["idx"])] = name if isinstance(name, str) and name else "Unnamed road"
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description="Load coverage GeoJSON into PostGIS.")
    parser.add_argument("--region", required=True, choices=sorted(REGIONS), help="Region id")
    parser.add_argument("--file", required=True, help="GeoJSON path from fetch_coverage.py")
    args = parser.parse_args()
    region = REGIONS[args.region]
    today = date.today()

    geojson_path = Path(args.file)
    if not geojson_path.is_absolute():
        geojson_path = DATA_DIR / geojson_path
    features = json.loads(geojson_path.read_text(encoding="utf-8"))["features"]
    print(f"Loaded {len(features):,} features from {geojson_path.name}")

    gaps = [
        (i, f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1])
        for i, f in enumerate(features)
        if f["properties"]["status"] == "ZERO_RESULTS"
    ]
    gap_names: dict[int, str] = {}
    if gaps:
        print(f"Resolving road names for {len(gaps):,} gap points ...")
        gap_names = nearest_road_names(args.region, gaps)

    sample_rows = [
        (
            args.region,
            f["properties"]["pano_id"] or None,
            f["properties"]["date"] or None,
            f["properties"]["source"],
            f["properties"]["status"],
            gap_names.get(i),
            f["geometry"]["coordinates"][0],
            f["geometry"]["coordinates"][1],
        )
        for i, f in enumerate(features)
    ]

    print(f"Aggregating hexbins at resolutions {HEX_RESOLUTIONS} ...")
    hexbin_rows = build_hexbin_rows(args.region, features, today)
    print(f"  {len(hexbin_rows):,} hex cells")

    conn = psycopg2.connect(load_database_url())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(DDL)

            cur.execute("DELETE FROM coverage_samples WHERE region = %s", (args.region,))
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO coverage_samples
                    (region, pano_id, date, source, status, nearest_road, geom)
                VALUES %s
                """,
                sample_rows,
                template="(%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                page_size=1000,
            )

            cur.execute("DELETE FROM coverage_hexbins WHERE region = %s", (args.region,))
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO coverage_hexbins
                    (region, resolution, hex_id, coverage_count, coverage_density,
                     avg_age_years, oldest_date, newest_date, official_ratio, geom)
                VALUES %s
                """,
                hexbin_rows,
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
                (args.region, region.name, *region.bbox, len(features), today),
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
