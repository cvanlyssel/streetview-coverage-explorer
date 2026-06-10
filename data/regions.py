"""Region definitions for the coverage pipeline.

Bboxes are (west, south, east, north) in WGS84, matching the API contract.
Each region also has a small `test_bbox` for cheap pipeline verification runs.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class RegionConfig:
    region_id: str
    name: str
    bbox: tuple[float, float, float, float]
    test_bbox: tuple[float, float, float, float]


REGIONS: dict[str, RegionConfig] = {
    "madison": RegionConfig(
        region_id="madison",
        name="Madison, WI",
        bbox=(-89.55, 43.02, -89.3, 43.15),
        # Downtown isthmus + part of campus: dense coverage, quick to sample
        test_bbox=(-89.41, 43.06, -89.365, 43.085),
    ),
}
