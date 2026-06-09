# Street View Coverage Explorer

Interactive web app that analyzes and visualizes Google Street View **coverage metadata** —
where coverage exists, how old it is, official vs. user-uploaded, and where the gaps are.

## Structure

```
/frontend   Vite + React + TypeScript + Tailwind + Framer Motion + MapLibre GL + deck.gl
/backend    FastAPI JSON/GeoJSON API
/data       Python pipeline: road sampling + Street View metadata fetch + PostGIS load
/docs       Design brief, API contract, kickoff plan
```

## Development

```sh
# Frontend
cd frontend
npm install
npm run dev          # http://localhost:5173

# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://localhost:8000/api/health
```

See `docs/API_CONTRACT.md` for the data shapes and `CLAUDE.md` for project conventions.
