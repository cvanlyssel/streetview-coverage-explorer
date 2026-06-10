"""Load a coverage GeoJSON (from fetch_coverage.py) into PostGIS.

Usage:
    python load_postgis.py --region madison --file output/coverage.madison.geojson

Reads DATABASE_URL from backend/.env (or data/.env). Creates the
coverage_samples table if needed and replaces that region's rows.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import dotenv_values

DATA_DIR = Path(__file__).resolve().parent

DDL = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS coverage_samples (
    id        BIGSERIAL PRIMARY KEY,
    region    TEXT NOT NULL,
    pano_id   TEXT,
    date      TEXT,
    source    TEXT NOT NULL CHECK (source IN ('google', 'unofficial')),
    status    TEXT NOT NULL CHECK (status IN ('OK', 'ZERO_RESULTS')),
    geom      GEOMETRY(POINT, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS coverage_samples_region_idx ON coverage_samples (region);
CREATE INDEX IF NOT EXISTS coverage_samples_geom_idx ON coverage_samples USING GIST (geom);
"""


def load_database_url() -> str:
    for env_path in (DATA_DIR.parent / "backend" / ".env", DATA_DIR / ".env"):
        if env_path.exists():
            url = dotenv_values(env_path).get("DATABASE_URL")
            if url:
                return url
    sys.exit("DATABASE_URL not found in backend/.env or data/.env")


def main() -> None:
    parser = argparse.ArgumentParser(description="Load coverage GeoJSON into PostGIS.")
    parser.add_argument("--region", required=True, help="Region id, e.g. madison")
    parser.add_argument("--file", required=True, help="GeoJSON path from fetch_coverage.py")
    args = parser.parse_args()

    geojson_path = Path(args.file)
    if not geojson_path.is_absolute():
        geojson_path = DATA_DIR / geojson_path
    features = json.loads(geojson_path.read_text(encoding="utf-8"))["features"]
    print(f"Loaded {len(features):,} features from {geojson_path.name}")

    rows = [
        (
            args.region,
            f["properties"]["pano_id"] or None,
            f["properties"]["date"] or None,
            f["properties"]["source"],
            f["properties"]["status"],
            f["geometry"]["coordinates"][0],
            f["geometry"]["coordinates"][1],
        )
        for f in features
    ]

    conn = psycopg2.connect(load_database_url())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute("DELETE FROM coverage_samples WHERE region = %s", (args.region,))
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO coverage_samples (region, pano_id, date, source, status, geom)
                VALUES %s
                """,
                rows,
                template="(%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                page_size=1000,
            )
            cur.execute(
                "SELECT count(*) FROM coverage_samples WHERE region = %s", (args.region,)
            )
            print(f"coverage_samples now has {cur.fetchone()[0]:,} rows for region={args.region}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
