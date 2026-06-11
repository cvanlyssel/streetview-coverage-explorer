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
    # Statewide regions: osmnx place queries built one at a time (memory-bounded)
    # instead of one giant bbox graph. Empty = use bbox.
    counties: tuple[str, ...] = ()
    # CRS used for metric interpolation along edges. Existing regions keep UTM 16N
    # (32616) — changing it would shift sampled coords and orphan their caches.
    metric_epsg: int = 32616


# All 72 Wisconsin counties, as osmnx/Nominatim place queries.
_WI_COUNTIES = (
    "Adams", "Ashland", "Barron", "Bayfield", "Brown", "Buffalo", "Burnett",
    "Calumet", "Chippewa", "Clark", "Columbia", "Crawford", "Dane", "Dodge",
    "Door", "Douglas", "Dunn", "Eau Claire", "Florence", "Fond du Lac",
    "Forest", "Grant", "Green", "Green Lake", "Iowa", "Iron", "Jackson",
    "Jefferson", "Juneau", "Kenosha", "Kewaunee", "La Crosse", "Lafayette",
    "Langlade", "Lincoln", "Manitowoc", "Marathon", "Marinette", "Marquette",
    "Menominee", "Milwaukee", "Monroe", "Oconto", "Oneida", "Outagamie",
    "Ozaukee", "Pepin", "Pierce", "Polk", "Portage", "Price", "Racine",
    "Richland", "Rock", "Rusk", "Sauk", "Sawyer", "Shawano", "Sheboygan",
    "St. Croix", "Taylor", "Trempealeau", "Vernon", "Vilas", "Walworth",
    "Washburn", "Washington", "Waukesha", "Waupaca", "Waushara", "Winnebago",
    "Wood",
)

REGIONS: dict[str, RegionConfig] = {
    "madison": RegionConfig(
        region_id="madison",
        name="Madison, WI",
        bbox=(-89.55, 43.02, -89.3, 43.15),
        # Downtown isthmus + part of campus: dense coverage, quick to sample
        test_bbox=(-89.41, 43.06, -89.365, 43.085),
    ),
    "milwaukee": RegionConfig(
        region_id="milwaukee",
        name="Milwaukee, WI",
        # Brown Deer down to Oak Creek, lakefront west past Wauwatosa
        bbox=(-88.07, 42.92, -87.85, 43.19),
        # Downtown + Third Ward
        test_bbox=(-87.93, 43.02, -87.89, 43.05),
    ),
    "wisconsin": RegionConfig(
        region_id="wisconsin",
        name="Wisconsin (statewide)",
        bbox=(-92.89, 42.49, -86.80, 47.08),
        # Dodgeville area: small rural patch for cheap pipeline checks
        test_bbox=(-90.02, 42.93, -89.95, 42.99),
        counties=tuple(f"{c} County, Wisconsin, USA" for c in _WI_COUNTIES),
        # Wisconsin Transverse Mercator — statewide metric CRS, unlike the
        # UTM 16N zone the two city regions were sampled in.
        metric_epsg=3071,
    ),
}
