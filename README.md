# Drift Master - Competition Management System

Complete local deployment for a drift championship platform that supports:

- Multi-classification / multi-competition management
- Driver registration with unique numbers
- Judge management and assignment per competition
- Qualifying (2 runs, 0-100, multi-judge averages)
- Live qualifying updates via WebSocket
- Full tournament progression:
  - Group A/B assignment from qualifying (1st A, 2nd B, 3rd A, ...)
  - In-group round-robin battles
  - Battle ordering that avoids consecutive-driver battles when possible
  - Two-run battles, judges split 10 points each run
  - OMT (One More Time) with additional 2 runs until winner exists
  - Semi-finals, final, and 3rd-place battle
- Competition points + qualifying points + qualifying rank bonus (+3/+2/+1)
- Global classification standings across all competitions
- End-of-classification rule: drop exactly one lowest competition score per driver

---

## Tech stack

- Backend: Python 3.11+, FastAPI, SQLAlchemy, SQLite
- Frontend: React 19 + Vite
- Runtime: Uvicorn
- Tests: Pytest

---

## Local run (without Docker)

### Option A: React dev server + FastAPI API

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm --prefix frontend install
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
npm --prefix frontend run dev
```

Open:

- React app: `http://localhost:5173/`
- API docs: `http://localhost:8000/docs`

### Option B: Build React and serve from FastAPI

```bash
npm --prefix frontend run build
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open:

- App home: `http://localhost:8000/`
- API docs: `http://localhost:8000/docs`

---

## Docker deployment

```bash
docker compose up --build
```

The image builds React first and serves the compiled app from FastAPI.

Available at `http://localhost:8000`.

SQLite data persists in `./data/drift_master.db` (mapped by compose).

---

## Core API flow

1. Create classification
2. Create competition inside classification
3. Create drivers and judges
4. Assign drivers + judges to competition
5. Submit qualifying scores
6. Start tournament
7. Submit battle run scores
8. Read competition standings
9. Read global classification standings
10. Close classification to apply drop-lowest rule

### Main endpoints

- `POST /classifications`
- `GET /classifications`
- `POST /classifications/{id}/close`
- `GET /classifications/{id}/standings`
- `POST /competitions`
- `GET /competitions`
- `POST /drivers`
- `GET /drivers`
- `POST /judges`
- `GET /judges`
- `POST /competitions/{id}/drivers`
- `POST /competitions/{id}/judges`
- `POST /competitions/{id}/qualifying/scores`
- `GET /competitions/{id}/qualifying/leaderboard`
- `POST /competitions/{id}/tournament/start`
- `GET /competitions/{id}/battles`
- `POST /battles/{id}/scores`
- `GET /competitions/{id}/groups/A/standings`
- `GET /competitions/{id}/groups/B/standings`
- `GET /competitions/{id}/standings`

---

## Rules implemented

All scoring outputs in the system are normalized to **2 decimal places**.

## 1) Qualifying

- Each driver has 2 runs.
- Judges score each run in `[0, 100]`.
- Run score = average of judge scores for that run.
- Qualifying score = best run score (`max(run1_avg, run2_avg)`).
- Live leaderboard updates can be consumed via:
  - `GET /competitions/{id}/qualifying/leaderboard`
  - `WS /ws/competitions/{id}/leaderboard`

### Judge scoring screen (mobile-friendly)

- Judges can open the React app and use the **Judge Scoring (Mobile)** tab.
- The same screen supports:
  - Qualifying score entry
  - Battle score entry for all phases (group, semifinals, 3rd place, final, OMT rounds)
- Optional direct URL: `/judge?tab=judge`

## 2) Group assignment and battles

- Based on qualifying rank:
  - 1st -> Group A
  - 2nd -> Group B
  - 3rd -> Group A
  - 4th -> Group B
  - ...
- Inside each group, every driver battles every other driver (round robin).
- Match ordering attempts to avoid a driver appearing in consecutive battles whenever possible.

## 3) Battle scoring and OMT

- Each battle is evaluated over 2 runs.
- For each run, each judge must split exactly 10 points between both drivers.
- Run score per driver = average judge points for that run.
- Battle round score per driver = average of the 2 run scores.
- If tie, battle goes to OMT:
  - another 2 runs are scored
  - repeat OMT rounds until winner is found

## 4) Tournament progression

- After group stage:
  - SF1: 1st Group A vs 2nd Group B
  - SF2: 1st Group B vs 2nd Group A
- Winners -> Final
- Losers -> 3rd place battle
- Final winner = competition winner

## 5) Competition points

- 1st: 100
- 2nd: 88
- 3rd: 76
- 4th: 64
- 5th-8th: 48
- 9th-16th: 32
- 17th-32nd: 16

Additional qualifying contribution:

- Add qualifying score to competition points
- Add bonus:
  - +3 for qualifying 1st
  - +2 for qualifying 2nd
  - +1 for qualifying 3rd

## 6) Global classification

- Aggregates driver points from all completed competitions in classification.
- Drivers can miss competitions; only entered competitions count.
- When classification is closed (`POST /classifications/{id}/close`):
  - exactly one lowest competition score per driver is dropped
  - if multiple equal minimum values exist, only one is dropped

---

## Development

Run tests:

```bash
pytest -q
```

Quick commands:

```bash
make install
make run
make test
make frontend-install
make frontend-dev
make frontend-build
```