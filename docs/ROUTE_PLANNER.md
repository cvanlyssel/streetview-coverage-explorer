# Gap-filling route planner — design

**Goal:** turn a region's coverage gaps into an efficient driving/biking route
a photographer could actually follow to fill them with photospheres, exportable
as GPX. Madison has 1,261 gap points; nobody wants to plan that by hand.

**Status:** local-only, behind a frontend feature flag. Not deployed.

## How a route is computed (pipeline, not request-time)

Routes are precomputed by `data/plan_route.py --region madison --mode drive`
and stored in PostGIS, matching the repo's philosophy (hexbins are precomputed
too): the API stays a dumb, fast reader and production never runs osmnx.

1. **Load gaps** from `coverage_samples` (`status = 'ZERO_RESULTS'`).
2. **Cluster gaps into stops.** Consecutive 50 m sample points on one missing
   street are a single visit. Grid-greedy clustering with ~150 m radius;
   each cluster becomes a stop at its centroid, labeled by the most common
   `nearest_road` among its members. Caps at 250 stops by raising the radius —
   beyond that a route stops being a day trip.
3. **Snap stops** to the nearest node of the region's osmnx drive graph
   (already in the local osmnx cache — no network calls). Bike mode uses the
   same street graph with a different speed model (15 km/h vs. driving
   speeds); a separate bike network would require Overpass, which is
   deliberately avoided.
4. **Distance matrix** via one Dijkstra per stop (length-weighted).
   Unreachable pairs (disconnected subgraphs) get a euclidean×1.5 fallback.
5. **Order the stops:** open-path TSP, nearest-neighbor start + 2-opt
   improvement until converged (bounded at 2,000 passes). Exact optimality
   is irrelevant here; 2-opt typically lands within ~5–10% on road networks.
6. **Stitch legs** from the pairwise shortest paths, concatenating edge
   geometries into per-leg LineStrings.
7. **Persist** to a `route_plans` table: stats, the route FeatureCollection,
   and a ready-to-serve GPX document (stops as waypoints, legs as one track).

## API (added to API_CONTRACT.md)

- `GET /api/route-plan?region=madison&mode=drive` → `RoutePlan`:
  stats + FeatureCollection of ordered stop Points and leg LineStrings.
- `GET /api/route-plan/gpx?region=madison&mode=drive` → `application/gpx+xml`
  attachment.
- 404 when no plan exists for (region, mode) — the UI treats that as
  "not planned yet", not an error.

## UI (behind `VITE_FEATURE_ROUTE_PLANNER`)

A fifth-ish layer row, "Gap Route", appears in the sidebar only when the flag
is on and the active region has a plan. Activating it overlays the route on
the map (it composes with the gaps layer rather than replacing it):

```
┌─ Sidebar ──────────────┐ ┌─ Map ──────────────────────────────────────┐
│ ...                    │ │      ②───③                                 │
│ Coverage Gaps      ON  │ │     ╱     ╲        route: blue path        │
│ Gap Route          ON  │ │   ①        ④──⑤   stops: numbered dots    │
│                        │ │    ╲           ╲   gaps: red dots (gaps    │
│ ┌─ Gap Route ────────┐ │ │     ⑥───────────⑦         layer underneath)│
│ │ 18 stops · 42.3 km │ │ └────────────────────────────────────────────┘
│ │ ~1 h 40 min drive  │ │
│ │ [Download GPX]     │ │
│ └────────────────────┘ │
└────────────────────────┘
```

Stops render as numbered scatter dots with order labels; hovering a stop
shows its road name and gap count. The panel card shows totals and the GPX
download link (direct `<a href>` to the API).

## Non-goals (for now)

- Multi-day route splitting, start-point selection UI, turn-by-turn text.
- Live recomputation when data refreshes (rerun the pipeline script instead).
- Wisconsin statewide routes — clustering 100k+ rural gaps into one "route"
  is meaningless; the feature targets city regions.
