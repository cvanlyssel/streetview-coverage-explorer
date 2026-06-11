# Deployment plan (Step 8 prep — not yet executed)

Target architecture: **Render** (FastAPI + PostgreSQL/PostGIS) + **Vercel** (frontend).
Railway is the fallback if Render's free Postgres tier is too small for two regions
(~190k sample rows + ~80k hexbin rows — it won't be; both fit in well under 100 MB).

```
Browser ──> Vercel (static Vite build)
               │  VITE_API_BASE
               ▼
        Render web service (uvicorn app.main:app)
               │  DATABASE_URL (internal connection string)
               ▼
        Render PostgreSQL (postgis extension enabled)
```

The data pipeline is **not** deployed. Data is produced locally (`fetch_coverage.py`)
and pushed to the production database with `load_postgis.py` pointed at the external
connection string. The Google API key therefore never leaves the local machine —
production has no Google credentials at all.

## 1. Database (Render PostgreSQL)

1. Create a PostgreSQL instance (free tier, region: Ohio/us-east for latency).
2. PostGIS ships with Render Postgres; `load_postgis.py` runs
   `CREATE EXTENSION IF NOT EXISTS postgis` on first load, so no manual step.
3. Copy the **external** connection string for the local load, the **internal**
   one for the web service.
4. Load from the repo root (one command per region):
   ```sh
   cd data
   DATABASE_URL=<external-url> .venv/Scripts/python load_postgis.py \
       --region madison --file output/coverage.madison.geojson
   ```
   (`load_postgis.py` reads `DATABASE_URL` from the environment via data/.env —
   set it there temporarily rather than on the command line if shell history is
   a concern. Do not commit it.)

## 2. Backend (Render web service)

| Setting          | Value                                            |
| ---------------- | ------------------------------------------------ |
| Root directory   | `backend`                                        |
| Build command    | `pip install -r requirements.txt`                |
| Start command    | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check     | `/api/health`                                    |
| Env vars         | `DATABASE_URL` (internal string), `CORS_ORIGINS` |

**Code change required before deploy** (small, do at deploy time):

- `app/db.py` currently reads `DATABASE_URL` only from `backend/.env`; make it
  fall back to the `DATABASE_URL` environment variable (env var wins).
- `app/main.py` hardcodes `allow_origins` to localhost:5173; read a
  comma-separated `CORS_ORIGINS` env var instead, defaulting to the localhost
  pair for dev. Set it to the Vercel URL(s) in production.

## 3. Frontend (Vercel)

| Setting          | Value                       |
| ---------------- | --------------------------- |
| Root directory   | `frontend`                  |
| Framework preset | Vite                        |
| Build command    | `npm run build`             |
| Output dir       | `dist`                      |
| Env vars         | `VITE_API_BASE=https://<service>.onrender.com` |

`client.ts` already reads `import.meta.env.VITE_API_BASE` with a localhost
fallback, and `USE_MOCKS` is already false — no code change needed.

## 4. Order of operations

1. Create the database; load Madison (and Milwaukee when its fetch completes).
2. Make the two backend env-var changes; deploy the web service; curl
   `/api/health`, `/api/regions`, `/api/stats?region=madison` on the public URL.
3. Deploy the frontend with `VITE_API_BASE` set; add the resulting Vercel
   domain to `CORS_ORIGINS`; redeploy/restart the API.
4. Smoke-test the live site at 1920x1080 (all four layers, region switch,
   tooltips) and capture the production URL for the README.

## 5. Gotchas to expect

- **Render free-tier spin-down**: the API sleeps after idle and cold-starts in
  ~30-60 s. Acceptable for a portfolio demo; note it in the README, or pay for
  the starter tier during application season.
- **Mixed content**: VITE_API_BASE must be `https://`, not `http://`.
- **Connection limits**: free Postgres allows ~95 connections; the pool is
  capped at 5, fine.
- **CORS**: a missing Vercel preview-domain origin shows up as layers silently
  failing to load — check the browser console first.
- The repo's `.env` files stay untracked; production secrets live only in the
  Render/Vercel dashboards.
