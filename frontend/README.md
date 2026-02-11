# Drift Master React Frontend

React + Vite control panel for:

- Classifications and competitions
- Driver/judge creation
- Assignment to competition
- Qualifying score submission and leaderboard
- Tournament start and battle score submission
- Live websocket updates
- Competition + global standings

## Development

From repository root:

```bash
npm --prefix frontend install
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
npm --prefix frontend run dev
```

Open `http://localhost:5173`.

The dev server proxies API and websocket traffic to `http://localhost:8000`.

## Build for FastAPI static serving

```bash
npm --prefix frontend run build
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Build output goes to `app/static`, and FastAPI serves it at `/`.
