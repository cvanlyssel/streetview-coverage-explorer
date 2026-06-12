# Scaling to the full USA — extrapolation memo

Based on the Wisconsin statewide run (4,257,143 points, launched 2026-06-11).
Observed numbers below are from the first 2.85M requests; final totals will be
appended when the run completes (it has been statistically flat throughout).

## Observed (Wisconsin, 50 req/s target)

| Metric | Value |
| --- | --- |
| Sustained throughput | **50.0–50.3 req/s** (never below target − 1%) |
| Failures (exhausted retries) | **6 / 2,854,858 = 0.0002%** |
| Transient throttle signals | 57 (0.002%) — zero adaptive rate halvings triggered |
| Wall time projection | ~23.6 h for 4.26M points |
| Cache (JSONL) | 157 B/response avg (rural-heavy; urban ~207 B) |
| Output GeoJSON | ~253 B/feature |
| API cost | $0 — the Street View *metadata* endpoint is not billed |

Notes: 50 workers behind a shared pacer; the endpoint showed no sign of
caring at this rate. The cap in `fetch_coverage.py` is 100 req/s; a brief
controlled test at 100 is the obvious next experiment before any multi-state
run (expect ~2× everything below if it holds).

## Projection: all 50 states + DC

Scaling basis: Wisconsin has ~115k miles of public road (FHWA); the USA has
~4.17M miles → **×36** Wisconsin. Point counts scale with road length; the
50 m→100 m halving is slightly sublinear because way endpoints survive.

| | 50 m spacing | 100 m spacing |
| --- | --- | --- |
| Sample points | **~155M** | **~80M** |
| Fetch time @ 50 req/s | **~36 days** | ~18.5 days |
| Fetch time @ 100 req/s | ~18 days | **~9 days** |
| Response cache (JSONL) | ~25–32 GB | ~13–17 GB |
| Output GeoJSON | ~39 GB | ~20 GB |
| PostGIS (samples + indexes + hexbins) | ~30–40 GB | ~16–21 GB |

Operational implications:

- **Per-state everything.** One cache file, one points cache, one output file,
  one `regions` row per state — exactly the current layout. Any crash loses
  nothing (per-line cache flush) and any state can be re-run independently.
- **Road networks from Geofabrik PBF extracts, never Overpass.** Overpass
  per-IP-banned this machine 13 counties into Wisconsin; the PBF path did the
  whole state in 42 s. Geofabrik publishes per-state extracts; total download
  for the USA is ~12 GB.
- Postgres: 155M rows is past the comfortable free-tier ceiling by ~100×.
  A full-USA product wants partitioned tables (by state), hexbins only at
  res 5–8 nationally, and `/api/coverage/points` strictly bbox-gated.
- The fetch is the bottleneck and it is one API key's budget; nothing about
  the pipeline itself needs to change other than disk.

## Recommended state order

Principle: every phase ships a complete, demo-able region; risk ramps with
size; the interesting coverage stories come early enough to feature.

1. **Phase 1 — complete the Lake Michigan story (≈5× WI):** Illinois,
   Minnesota, Michigan, Iowa, Indiana. Contiguous with the existing data;
   the region switcher and globe already tell a coherent Midwest story.
2. **Phase 2 — small-state sweep (≈2× WI total):** RI, DE, CT, NJ, MA, NH,
   VT, MD. Eight quick wins; validates the pipeline against the densest
   urban corridors (NJ) at low absolute cost.
3. **Phase 3 — coverage-story states (≈4× WI):** Alaska (sparsest official
   coverage in the US), Nevada + Arizona (oldest surviving desert imagery),
   Hawaii (trekker-heavy), Montana/Wyoming (gap density).
4. **Phase 4 — the giants, one at a time (≈12× WI):** Texas (~2.7× WI),
   California (~1.7× WI), then the remaining South/Plains states in
   descending road mileage.

At 100 req/s and 100 m spacing the whole program is ~9 fetch-days spread
across phases; at the proven 50 req/s and 50 m it is a ~5-week background
process on one machine.
