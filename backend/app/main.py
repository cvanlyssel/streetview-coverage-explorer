"""FastAPI app implementing docs/API_CONTRACT.md against PostGIS.

All shapes are validated through the pydantic models in models.py, which mirror
frontend/src/api/types.ts. Hexbins are precomputed at load time by
data/load_postgis.py; everything else aggregates coverage_samples on the fly.
"""

from __future__ import annotations

import json
import os

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .db import get_conn
from .models import (
    AgeHistogramBin,
    CoverageSample,
    GapCollection,
    GapFeature,
    GapProperties,
    HexbinCollection,
    HexbinFeature,
    HexbinProperties,
    PointCollection,
    PointFeature,
    PointGeometry,
    PolygonGeometry,
    Region,
    RegionStats,
)

app = FastAPI(title="Street View Coverage Explorer API")

# Comma-separated CORS_ORIGINS in production (the Vercel domains);
# defaults to the local dev pair.
_cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Age of a 'YYYY-MM' pano date in years, relative to today (floored at 0).
AGE_YEARS_SQL = """
GREATEST(0, (EXTRACT(YEAR FROM CURRENT_DATE) - SUBSTRING(date, 1, 4)::int)
          + (EXTRACT(MONTH FROM CURRENT_DATE) - SUBSTRING(date, 6, 2)::int) / 12.0)
"""


def require_region(cur, region: str) -> None:
    cur.execute("SELECT 1 FROM regions WHERE region_id = %s", (region,))
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Unknown region: {region}")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/regions", response_model=list[Region])
def regions(conn=Depends(get_conn)) -> list[Region]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT region_id, name, west, south, east, north, point_count, last_updated
            FROM regions ORDER BY name
            """
        )
        return [
            Region(
                id=r[0],
                name=r[1],
                bbox=(r[2], r[3], r[4], r[5]),
                point_count=r[6],
                last_updated=r[7].isoformat(),
            )
            for r in cur.fetchall()
        ]


@app.get("/api/coverage/hexbins", response_model=HexbinCollection)
def hexbins(
    region: str,
    resolution: int = Query(default=8, ge=7, le=10),
    conn=Depends(get_conn),
) -> HexbinCollection:
    with conn.cursor() as cur:
        require_region(cur, region)
        cur.execute(
            """
            SELECT hex_id, coverage_count, coverage_density, avg_age_years,
                   oldest_date, newest_date, official_ratio, ST_AsGeoJSON(geom)
            FROM coverage_hexbins
            WHERE region = %s AND resolution = %s
            """,
            (region, resolution),
        )
        features = [
            HexbinFeature(
                geometry=PolygonGeometry(**json.loads(r[7])),
                properties=HexbinProperties(
                    hex_id=r[0],
                    coverage_count=r[1],
                    coverage_density=r[2],
                    avg_age_years=r[3],
                    oldest_date=r[4],
                    newest_date=r[5],
                    official_ratio=r[6],
                ),
            )
            for r in cur.fetchall()
        ]
    return HexbinCollection(features=features)


@app.get("/api/coverage/points", response_model=PointCollection)
def points(
    region: str,
    bbox: str | None = Query(default=None, description="west,south,east,north"),
    conn=Depends(get_conn),
) -> PointCollection:
    params: list = [region]
    bbox_sql = ""
    if bbox is not None:
        try:
            west, south, east, north = (float(v) for v in bbox.split(","))
        except ValueError:
            raise HTTPException(status_code=422, detail="bbox must be west,south,east,north")
        # ST_Intersects, not &&: box-only comparison happens in float4 and can
        # leak points ~1e-6 deg past the envelope edge
        bbox_sql = "AND ST_Intersects(geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))"
        params += [west, south, east, north]

    with conn.cursor() as cur:
        require_region(cur, region)
        cur.execute(
            f"""
            SELECT COALESCE(pano_id, ''), ST_Y(geom), ST_X(geom),
                   COALESCE(date, ''), source, status
            FROM coverage_samples
            WHERE region = %s {bbox_sql}
            """,
            params,
        )
        features = [
            PointFeature(
                geometry=PointGeometry(coordinates=(r[2], r[1])),
                properties=CoverageSample(
                    pano_id=r[0], lat=r[1], lng=r[2], date=r[3], source=r[4], status=r[5]
                ),
            )
            for r in cur.fetchall()
        ]
    return PointCollection(features=features)


@app.get("/api/coverage/gaps", response_model=GapCollection)
def gaps(region: str, conn=Depends(get_conn)) -> GapCollection:
    with conn.cursor() as cur:
        require_region(cur, region)
        cur.execute(
            """
            SELECT COALESCE(nearest_road, 'Unnamed road'), ST_X(geom), ST_Y(geom)
            FROM coverage_samples
            WHERE region = %s AND status = 'ZERO_RESULTS'
            """,
            (region,),
        )
        features = [
            GapFeature(
                geometry=PointGeometry(coordinates=(r[1], r[2])),
                properties=GapProperties(nearest_road=r[0]),
            )
            for r in cur.fetchall()
        ]
    return GapCollection(features=features)


@app.get("/api/stats", response_model=RegionStats)
def stats(region: str, conn=Depends(get_conn)) -> RegionStats:
    with conn.cursor() as cur:
        require_region(cur, region)
        cur.execute(
            f"""
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE status = 'OK') AS covered,
                   count(*) FILTER (WHERE status = 'OK' AND source = 'google') AS official,
                   AVG({AGE_YEARS_SQL}) FILTER (WHERE status = 'OK' AND date IS NOT NULL),
                   MIN(date) FILTER (WHERE status = 'OK'),
                   MAX(date) FILTER (WHERE status = 'OK')
            FROM coverage_samples
            WHERE region = %s
            """,
            (region,),
        )
        total, covered, official, avg_age, oldest, newest = cur.fetchone()

        cur.execute(
            """
            SELECT SUBSTRING(date, 1, 4)::int AS year, count(*)
            FROM coverage_samples
            WHERE region = %s AND status = 'OK' AND date IS NOT NULL
            GROUP BY year ORDER BY year
            """,
            (region,),
        )
        histogram = [AgeHistogramBin(year=r[0], count=r[1]) for r in cur.fetchall()]

    return RegionStats(
        region=region,
        total_samples=total,
        covered=covered,
        coverage_pct=round(100 * covered / total, 1) if total else 0.0,
        official_pct=round(100 * official / covered, 1) if covered else 0.0,
        avg_age_years=round(float(avg_age), 2) if avg_age is not None else 0.0,
        oldest_date=oldest or "",
        newest_date=newest or "",
        age_histogram=histogram,
    )
