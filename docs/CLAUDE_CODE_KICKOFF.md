# Claude Code Kickoff — step-by-step

The exact sequence of prompts to run in Claude Code. Do them in order. Each block is one focused
session/prompt. Let Claude Code finish, review, commit, then move on.

---

## Step 0 — One-time setup before you start

1. Put your design reference image(s) in `docs/design-reference/`.
2. Create a Google Cloud project, enable the **Street View Static API**, make an API key.
   You'll put it in `backend/.env` later — never commit it.
3. Install the **Playwright MCP** so Claude Code can screenshot its own work:
   ```
   claude mcp add playwright npx -- @playwright/mcp@latest
   ```
   (Run `claude mcp list` to confirm it's connected.)

---

## Step 1 — Scaffold the monorepo

> Prompt:
> "Read CLAUDE.md and docs/API_CONTRACT.md. Scaffold a monorepo with three parts:
> `/frontend` = Vite + React + TypeScript + Tailwind + Framer Motion, with MapLibre GL JS and
> deck.gl installed; `/backend` = a FastAPI app with a health route and CORS enabled; `/data` =
> a Python project (with requirements.txt) for the pipeline. Add a root `.gitignore` that ignores
> `.env`, `node_modules`, `__pycache__`, and build output. Add a root README stub. Don't build
> features yet — just the skeleton, and confirm both dev servers run."

After it finishes: `git init`, first commit.

---

## Step 2 — Mock data matching the contract

> Prompt:
> "Using docs/API_CONTRACT.md, generate realistic mock JSON for the Madison region in
> `frontend/src/mock/`: `regions.json`, `stats.madison.json`, `hexbins.madison.json` (a few hundred
> hexes with plausible values), and `gaps.madison.json`. Then create an API client in
> `frontend/src/api/` with a `USE_MOCKS` flag that returns mock data now and will hit the real
> backend later. Keep the function signatures stable."

---

## Step 3 — Build the UI shell with the screenshot loop  ← your main interest

> Prompt:
> "Build the UI per docs/DESIGN_BRIEF.md, reading data through the mock API client. Implement the
> full-bleed MapLibre map (dark style), the collapsible left control panel with region selector and
> layer toggles (Density / Age / Official vs Unofficial / Gaps), the top stats bar, the legend, and
> hover tooltips. Render the Density layer from the hexbin mock with deck.gl.
>
> Then enter a visual iteration loop: match docs/design-reference/reference-1.png. Use the Playwright
> MCP to run the dev server, navigate to it, take a screenshot, compare it to the reference, and keep
> refining the layout, spacing, colors, and typography until it closely matches. Show me the
> screenshots as you go."

Tips for the loop:
- Be specific about what's off ("legend is too large", "map should be full-bleed behind the panel").
- Iterate a few rounds; stop when it's close, not perfect.
- Add the Framer Motion animations from the brief once the static layout matches.

---

## Step 4 — Wire the remaining layers + animations

> Prompt:
> "Implement the Age, Official-vs-Unofficial, and Gaps layers from their mock data with appropriate
> deck.gl layer types and color ramps. Add the Framer Motion animations described in DESIGN_BRIEF.md
> (panel slide, layer cross-fade, count-up stats, region fly-to). Keep performance smooth."

---

## Step 5 — Data pipeline (the real coverage data)

> Prompt:
> "In `/data`, write the pipeline described in CLAUDE.md: use osmnx to pull Madison's road network
> and generate sample points along roads; for each point, call the Google Street View **metadata**
> endpoint (key from `.env`) and record pano_id, date, source (google vs unofficial via copyright),
> and status. Be polite with rate limiting and cache responses. Output a GeoJSON of points and a
> script to load them into PostGIS. Start with a small bbox to test, then scale up."

---

## Step 6 — Backend serves the contract

> Prompt:
> "Implement the FastAPI endpoints in docs/API_CONTRACT.md against the PostGIS data: /api/regions,
> /api/coverage/hexbins (aggregate points into H3 hexes with count, density, avg_age_years,
> official_ratio), /api/coverage/points, /api/coverage/gaps, /api/stats. Use pydantic models that
> mirror the contract. Add tests that assert response shapes match the contract."

---

## Step 7 — Flip the switch + deploy

> Prompt:
> "Set USE_MOCKS=false and point the frontend at the backend. Fix any shape mismatches by updating
> API_CONTRACT.md first, then both sides. Then help me deploy: backend + PostGIS on Render, frontend
> on Vercel, with environment variables documented in the README. Write the final README with
> screenshots, architecture, data methodology, and live links."

---

## Working style reminders for Claude Code

- One step at a time; review and commit between steps.
- If you change the data shape, change `docs/API_CONTRACT.md` first.
- Keep the API key out of code, logs, and screenshots.
- Prefer small, focused commits with clear messages.
