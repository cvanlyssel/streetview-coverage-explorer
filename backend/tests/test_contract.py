"""Shape tests: every endpoint must match docs/API_CONTRACT.md.

These run against the live local database (DATABASE_URL in backend/.env) with at
least one region loaded by data/load_postgis.py. They assert shapes and value
ranges, not specific data, so they pass for any loaded dataset.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import database_url
from app.main import app


def _db_available() -> bool:
    import psycopg2

    try:
        psycopg2.connect(database_url(), connect_timeout=3).close()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _db_available(), reason="local PostGIS not reachable"
)

client = TestClient(app)


@pytest.fixture(scope="module")
def region_id() -> str:
    regions = client.get("/api/regions").json()
    assert regions, "no regions loaded — run data/load_postgis.py first"
    return regions[0]["id"]


def test_regions_shape() -> None:
    res = client.get("/api/regions")
    assert res.status_code == 200
    for region in res.json():
        assert set(region) == {"id", "name", "bbox", "point_count", "last_updated"}
        west, south, east, north = region["bbox"]
        assert west < east and south < north
        assert region["point_count"] > 0
        assert len(region["last_updated"]) == 10  # YYYY-MM-DD


def test_hexbins_shape(region_id: str) -> None:
    res = client.get(f"/api/coverage/hexbins?region={region_id}&resolution=9")
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "FeatureCollection"
    assert body["features"], "expected hexbins for the loaded region"
    for feature in body["features"]:
        assert feature["type"] == "Feature"
        geom = feature["geometry"]
        assert geom["type"] == "Polygon"
        ring = geom["coordinates"][0]
        assert len(ring) >= 4 and ring[0] == ring[-1], "polygon ring must be closed"
        props = feature["properties"]
        assert set(props) == {
            "hex_id",
            "coverage_count",
            "coverage_density",
            "avg_age_years",
            "oldest_date",
            "newest_date",
            "official_ratio",
        }
        assert props["coverage_count"] >= 1
        assert 0 <= props["coverage_density"] <= 1
        assert 0 <= props["official_ratio"] <= 1
        assert props["avg_age_years"] >= 0


def test_hexbins_resolution_validation(region_id: str) -> None:
    assert client.get(f"/api/coverage/hexbins?region={region_id}&resolution=3").status_code == 422


def test_points_shape(region_id: str) -> None:
    res = client.get(f"/api/coverage/points?region={region_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "FeatureCollection"
    assert body["features"]
    for feature in body["features"][:200]:
        props = feature["properties"]
        assert set(props) == {"pano_id", "lat", "lng", "date", "source", "status"}
        assert props["source"] in ("google", "unofficial")
        assert props["status"] in ("OK", "ZERO_RESULTS")
        lng, lat = feature["geometry"]["coordinates"]
        assert lng == pytest.approx(props["lng"]) and lat == pytest.approx(props["lat"])
        if props["status"] == "OK":
            assert props["pano_id"] and len(props["date"]) == 7  # YYYY-MM


def test_points_bbox_filter(region_id: str) -> None:
    region = next(r for r in client.get("/api/regions").json() if r["id"] == region_id)
    west, south, east, north = region["bbox"]
    midx, midy = (west + east) / 2, (south + north) / 2
    sub = client.get(
        f"/api/coverage/points?region={region_id}&bbox={west},{south},{midx},{midy}"
    ).json()
    full = client.get(f"/api/coverage/points?region={region_id}").json()
    assert len(sub["features"]) < len(full["features"])
    for feature in sub["features"]:
        lng, lat = feature["geometry"]["coordinates"]
        assert west <= lng <= midx and south <= lat <= midy

    bad = client.get(f"/api/coverage/points?region={region_id}&bbox=1,2,3")
    assert bad.status_code == 422


def test_gaps_shape(region_id: str) -> None:
    res = client.get(f"/api/coverage/gaps?region={region_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "FeatureCollection"
    for feature in body["features"]:
        assert feature["geometry"]["type"] == "Point"
        assert isinstance(feature["properties"]["nearest_road"], str)
        assert feature["properties"]["nearest_road"]


def test_stats_shape(region_id: str) -> None:
    res = client.get(f"/api/stats?region={region_id}")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {
        "region",
        "total_samples",
        "covered",
        "coverage_pct",
        "official_pct",
        "avg_age_years",
        "oldest_date",
        "newest_date",
        "age_histogram",
    }
    assert body["region"] == region_id
    assert 0 < body["covered"] <= body["total_samples"]
    assert 0 <= body["coverage_pct"] <= 100
    assert 0 <= body["official_pct"] <= 100
    assert body["age_histogram"], "expected at least one histogram bin"
    years = [b["year"] for b in body["age_histogram"]]
    assert years == sorted(years)
    assert sum(b["count"] for b in body["age_histogram"]) == body["covered"]


def test_unknown_region_404() -> None:
    for path in (
        "/api/coverage/hexbins?region=nowhere",
        "/api/coverage/points?region=nowhere",
        "/api/coverage/gaps?region=nowhere",
        "/api/stats?region=nowhere",
    ):
        assert client.get(path).status_code == 404
