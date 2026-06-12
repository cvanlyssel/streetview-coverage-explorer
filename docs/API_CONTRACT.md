# API Contract — Street View Coverage Explorer

This is the **single source of truth** for data exchanged between backend and frontend. Build the
frontend against mock data matching these shapes; build the backend to return exactly these shapes.

All geographic responses are valid **GeoJSON**. Coordinates are `[lng, lat]` (GeoJSON order).
Dates are `"YYYY-MM"` strings (Street View metadata only gives month precision).

---

## Core entity: a coverage sample

One sampled point and what Google's metadata returned for it.

```json
{
  "pano_id": "CAoSLEFGMVFpcE...",
  "lat": 43.0731,
  "lng": -89.4012,
  "date": "2023-07",
  "source": "google",            // "google" | "unofficial"
  "status": "OK"                  // "OK" | "ZERO_RESULTS"
}
```

- `source` = `"unofficial"` when the metadata `copyright` is not "© Google" (user photospheres).
- `status` = `"ZERO_RESULTS"` means no coverage at that sample point (used for gap analysis).

---

## Endpoints

### `GET /api/regions`
List of precomputed regions the user can explore.
```json
[
  { "id": "madison", "name": "Madison, WI", "bbox": [-89.55, 43.02, -89.30, 43.15],
    "point_count": 52340, "last_updated": "2026-06-15" }
]
```

### `GET /api/coverage/hexbins?region=madison&resolution=8`
Aggregated hexagon grid (use H3 or square bins) — the primary layer source.
FeatureCollection where each feature is a hex polygon with aggregated properties.
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[[ -89.40,43.07 ], ...]] },
      "properties": {
        "hex_id": "8826...",
        "coverage_count": 184,
        "coverage_density": 0.73,     // 0..1 normalized for color scaling
        "avg_age_years": 2.6,
        "oldest_date": "2009-08",
        "newest_date": "2024-05",
        "official_ratio": 0.91         // share of samples that are "google"
      }
    }
  ]
}
```

### `GET /api/coverage/points?region=madison&bbox=...`
Raw sample points (for high zoom). Same hexbin info but per point.
FeatureCollection of Point features whose properties match the **core entity** above.

### `GET /api/coverage/gaps?region=madison`
Road segments (or areas) with `status = ZERO_RESULTS`.
FeatureCollection of LineString/Point features:
```json
{ "type":"Feature", "geometry":{"type":"Point","coordinates":[-89.41,43.06]},
  "properties": { "nearest_road": "W Johnson St" } }
```

### `GET /api/stats?region=madison`
Summary numbers for the dashboard/header.
```json
{
  "region": "madison",
  "total_samples": 52340,
  "covered": 48120,
  "coverage_pct": 91.9,
  "official_pct": 88.4,
  "avg_age_years": 3.1,
  "oldest_date": "2008-06",
  "newest_date": "2024-09",
  "age_histogram": [ { "year": 2009, "count": 1200 }, { "year": 2010, "count": 980 } ]
}
```

### `GET /api/route-plan?region=madison&mode=drive`
Precomputed gap-filling route (see `ROUTE_PLANNER.md`). `mode` is `"drive" | "bike"`.
**404** when no plan exists for the (region, mode) pair — clients treat that as
"not planned", not an error. Feature-flagged in the UI; local-only for now.
```json
{
  "region": "madison",
  "mode": "drive",
  "n_stops": 18,
  "total_km": 42.3,
  "est_minutes": 101,
  "route": {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-89.41, 43.06] },
        "properties": { "kind": "stop", "order": 1, "road": "Eastpark Blvd", "gap_count": 14 } },
      { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[-89.41,43.06], [-89.40,43.07]] },
        "properties": { "kind": "leg", "order": 1, "length_km": 2.1 } }
    ]
  }
}
```
- Stop `order` is 1-based visit order; leg `order` n connects stop n to stop n+1.

### `GET /api/route-plan/gpx?region=madison&mode=drive`
The same plan as `application/gpx+xml` (attachment): stops as `<wpt>`, the
full route as one `<trk>`. Same 404 semantics.

---

## Mock data

While building the UI, generate a `frontend/src/mock/` folder with small JSON files matching each
endpoint above (e.g. `hexbins.madison.json`, `stats.madison.json`). A `USE_MOCKS` flag in the API
client swaps between mock files and the real backend so the frontend never blocks on the backend.
