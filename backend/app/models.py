"""Pydantic models mirroring docs/API_CONTRACT.md (and frontend/src/api/types.ts).

If a shape needs to change, update the contract first, then both sides.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CoverageSource = Literal["google", "unofficial"]
CoverageStatus = Literal["OK", "ZERO_RESULTS"]


class PointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]  # [lng, lat]


class PolygonGeometry(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]]


# --- GET /api/regions ---------------------------------------------------------


class Region(BaseModel):
    id: str
    name: str
    bbox: tuple[float, float, float, float]  # [west, south, east, north]
    point_count: int
    last_updated: str  # "YYYY-MM-DD"


# --- GET /api/coverage/hexbins --------------------------------------------------


class HexbinProperties(BaseModel):
    hex_id: str
    coverage_count: int
    coverage_density: float = Field(ge=0, le=1)
    avg_age_years: float
    oldest_date: str  # "YYYY-MM"
    newest_date: str  # "YYYY-MM"
    official_ratio: float = Field(ge=0, le=1)


class HexbinFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: PolygonGeometry
    properties: HexbinProperties


class HexbinCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[HexbinFeature]


# --- GET /api/coverage/points ---------------------------------------------------


class CoverageSample(BaseModel):
    pano_id: str
    lat: float
    lng: float
    date: str  # "YYYY-MM", empty for gaps
    source: CoverageSource
    status: CoverageStatus


class PointFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: PointGeometry
    properties: CoverageSample


class PointCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[PointFeature]


# --- GET /api/coverage/gaps -----------------------------------------------------


class GapProperties(BaseModel):
    nearest_road: str


class GapFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: PointGeometry
    properties: GapProperties


class GapCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GapFeature]


# --- GET /api/stats ---------------------------------------------------------------


class AgeHistogramBin(BaseModel):
    year: int
    count: int


class RegionStats(BaseModel):
    region: str
    total_samples: int
    covered: int
    coverage_pct: float
    official_pct: float
    avg_age_years: float
    oldest_date: str  # "YYYY-MM"
    newest_date: str  # "YYYY-MM"
    age_histogram: list[AgeHistogramBin]
