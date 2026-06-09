# CLAUDE.md — Street View Coverage Explorer

Project context for Claude Code. Read this first, every session.

## What we're building

An interactive web app that analyzes and visualizes **Google Street View coverage** across a
region — not the imagery, but the *metadata*: where coverage exists, how old it is, whether it's
official Google coverage or user-uploaded, and where the gaps are. Think of it as a data product
for the "coverage meta" that GeoGuessr map-makers care about.

Signature map layers:
- **Coverage density** — heatmap of how much Street View exists per area
- **Coverage age** — how stale Google's imagery is (oldest coverage stands out)
- **Official vs. unofficial** — Google car/trekker vs. user photospheres
- **Coverage gaps** — roads with no Street View

## Tech stack

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, Framer Motion (animation), MapLibre GL JS (base map), deck.gl (data layers)
- **Backend:** Python, FastAPI, served as a JSON/GeoJSON API
- **Data store:** PostgreSQL + PostGIS
- **Data pipeline:** Python scripts using `osmnx` (road network + sample grid) and the Google Street View **metadata** endpoint (free, no quota)
- **Deploy:** Render or Railway (API + DB), Vercel (frontend)

## Repo structure (monorepo)

```
/frontend     # Vite React app (UI, map, layers)
/backend      # FastAPI app (serves the API contract)
/data         # Python pipeline: sampling + metadata fetch + load to PostGIS
/docs         # DESIGN_BRIEF.md, API_CONTRACT.md, CLAUDE_CODE_KICKOFF.md
```

## The golden rule: build to the contract

`docs/API_CONTRACT.md` is the single source of truth for the shape of data passed between backend
and frontend. The frontend is built first against **mock data that matches the contract**, then the
backend is wired to fulfill the exact same contract. Never let the two drift — if the shape needs to
change, update `API_CONTRACT.md` first, then both sides.

## Conventions

- TypeScript strict mode on the frontend. Functional components + hooks.
- Keep map state (active layer, bbox, selected region) in one place (a small store or context).
- Python: type hints, `ruff` for lint, `pydantic` models that mirror the API contract.
- Small, focused commits with clear messages.

## Security — do not violate

- The Google API key lives in `.env` (backend/data only) and is **never** committed. `.env` is gitignored.
- Never print the key in logs or screenshots.
- Frontend never calls Google directly — it only talks to our backend.

## Commands (fill in as they're created)

- Frontend dev: `cd frontend && npm run dev`
- Backend dev: `cd backend && uvicorn app.main:app --reload`
- Pipeline: `cd data && python fetch_coverage.py --region madison`

## Visual development loop

When building UI, use the Playwright MCP to screenshot the running dev server and compare against
the reference image in `docs/design-reference/`. Iterate until it matches. See
`docs/CLAUDE_CODE_KICKOFF.md` for the exact workflow.
