from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import Competition, CompetitionDriver, CompetitionJudge, Driver, GlobalClassification, Judge
from app.schemas import (
    CompetitionCreate,
    CompetitionDriversAssign,
    CompetitionJudgesAssign,
    DriverCreate,
    GlobalClassificationCreate,
    JudgeCreate,
    QualifyingScoreUpsert,
    BattleRunScoreUpsert,
)
from app.services import (
    battle_state,
    competition_driver_standings,
    get_battle_or_404,
    get_classification_or_404,
    get_competition_or_404,
    global_classification_standings,
    group_standings,
    list_competition_battles,
    qualifying_leaderboard,
    require_open_classification,
    start_tournament,
    try_progress_competition,
    upsert_battle_run_score,
    upsert_qualifying_score,
)


class LeaderboardHub:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, competition_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[competition_id].add(ws)

    def disconnect(self, competition_id: int, ws: WebSocket) -> None:
        if competition_id in self._connections and ws in self._connections[competition_id]:
            self._connections[competition_id].remove(ws)
            if not self._connections[competition_id]:
                del self._connections[competition_id]

    async def broadcast(self, competition_id: int, payload: dict[str, Any]) -> None:
        targets = list(self._connections.get(competition_id, set()))
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(competition_id, ws)


app = FastAPI(
    title="Drift Master - Competition Management System",
    version="1.0.0",
    description=(
        "Phase 1 + Phase 2 system: qualifying, group battles, semifinals, "
        "OMT support, finals, and global classification points."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

hub = LeaderboardHub()


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


static_dir = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


def _competition_summary(db: Session, competition: Competition) -> dict[str, Any]:
    driver_count = (
        db.query(CompetitionDriver).filter(CompetitionDriver.competition_id == competition.id).count()
    )
    judge_count = (
        db.query(CompetitionJudge).filter(CompetitionJudge.competition_id == competition.id).count()
    )
    return {
        "id": competition.id,
        "name": competition.name,
        "classification_id": competition.classification_id,
        "status": competition.status,
        "driver_count": driver_count,
        "judge_count": judge_count,
    }


@app.get("/")
def root() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/judge")
def judge_screen() -> FileResponse:
    # Dedicated mobile-friendly judge entry screen is rendered by React tab view.
    return FileResponse(static_dir / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/classifications")
def create_classification(payload: GlobalClassificationCreate, db: Session = Depends(get_db)):
    existing = db.scalar(
        select(GlobalClassification).where(GlobalClassification.name == payload.name.strip())
    )
    if existing:
        raise HTTPException(status_code=400, detail="Classification name already exists")
    cls = GlobalClassification(name=payload.name.strip())
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return {"id": cls.id, "name": cls.name, "is_closed": cls.is_closed}


@app.get("/classifications")
def list_classifications(db: Session = Depends(get_db)):
    rows = db.scalars(select(GlobalClassification).order_by(GlobalClassification.id.asc())).all()
    return [
        {"id": c.id, "name": c.name, "is_closed": c.is_closed, "created_at": c.created_at}
        for c in rows
    ]


@app.post("/classifications/{classification_id}/close")
def close_classification(classification_id: int, db: Session = Depends(get_db)):
    cls = get_classification_or_404(db, classification_id)
    cls.is_closed = True
    db.commit()
    return {"id": cls.id, "name": cls.name, "is_closed": cls.is_closed}


@app.get("/classifications/{classification_id}/standings")
def classification_standings(classification_id: int, db: Session = Depends(get_db)):
    cls = get_classification_or_404(db, classification_id)
    return {
        "classification_id": cls.id,
        "classification_name": cls.name,
        "is_closed": cls.is_closed,
        "standings": global_classification_standings(db, classification_id),
    }


@app.post("/competitions")
def create_competition(payload: CompetitionCreate, db: Session = Depends(get_db)):
    cls = get_classification_or_404(db, payload.classification_id)
    require_open_classification(cls)
    comp = Competition(classification_id=cls.id, name=payload.name.strip())
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return _competition_summary(db, comp)


@app.get("/competitions")
def list_competitions(db: Session = Depends(get_db)):
    rows = db.scalars(select(Competition).order_by(Competition.id.asc())).all()
    return [_competition_summary(db, c) for c in rows]


@app.get("/competitions/{competition_id}")
def get_competition(competition_id: int, db: Session = Depends(get_db)):
    comp = get_competition_or_404(db, competition_id)
    return _competition_summary(db, comp)


@app.post("/drivers")
def create_driver(payload: DriverCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(Driver).where(Driver.number == payload.number))
    if existing:
        raise HTTPException(status_code=400, detail="Driver number already exists")
    d = Driver(name=payload.name.strip(), number=payload.number)
    db.add(d)
    db.commit()
    db.refresh(d)
    return {"id": d.id, "name": d.name, "number": d.number}


@app.get("/drivers")
def list_drivers(db: Session = Depends(get_db)):
    rows = db.scalars(select(Driver).order_by(Driver.number.asc())).all()
    return [{"id": d.id, "name": d.name, "number": d.number} for d in rows]


@app.post("/judges")
def create_judge(payload: JudgeCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(Judge).where(Judge.name == payload.name.strip()))
    if existing:
        raise HTTPException(status_code=400, detail="Judge name already exists")
    j = Judge(name=payload.name.strip())
    db.add(j)
    db.commit()
    db.refresh(j)
    return {"id": j.id, "name": j.name}


@app.get("/judges")
def list_judges(db: Session = Depends(get_db)):
    rows = db.scalars(select(Judge).order_by(Judge.id.asc())).all()
    return [{"id": j.id, "name": j.name} for j in rows]


@app.get("/competitions/{competition_id}/drivers")
def list_competition_drivers(competition_id: int, db: Session = Depends(get_db)):
    get_competition_or_404(db, competition_id)
    rows = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id == competition_id)
    ).all()
    if not rows:
        return []
    driver_ids = [row.driver_id for row in rows]
    drivers = {
        d.id: d for d in db.scalars(select(Driver).where(Driver.id.in_(driver_ids))).all()
    }
    payload = []
    for row in rows:
        d = drivers.get(row.driver_id)
        if not d:
            continue
        payload.append(
            {
                "id": d.id,
                "name": d.name,
                "number": d.number,
                "group_name": row.group_name,
                "qualifying_rank": row.qualifying_rank,
            }
        )
    payload.sort(key=lambda item: item["number"])
    return payload


@app.get("/competitions/{competition_id}/judges")
def list_competition_judges(competition_id: int, db: Session = Depends(get_db)):
    get_competition_or_404(db, competition_id)
    rows = db.scalars(
        select(CompetitionJudge).where(CompetitionJudge.competition_id == competition_id)
    ).all()
    if not rows:
        return []
    judge_ids = [row.judge_id for row in rows]
    judges = db.scalars(select(Judge).where(Judge.id.in_(judge_ids))).all()
    payload = [{"id": j.id, "name": j.name} for j in judges]
    payload.sort(key=lambda item: (item["name"], item["id"]))
    return payload


@app.post("/competitions/{competition_id}/drivers")
def assign_drivers_to_competition(
    competition_id: int,
    payload: CompetitionDriversAssign,
    db: Session = Depends(get_db),
):
    comp = get_competition_or_404(db, competition_id)
    if comp.status != "qualifying":
        raise HTTPException(status_code=400, detail="Can only modify competition before tournament starts")

    ids = sorted(set(payload.driver_ids))
    if not ids:
        raise HTTPException(status_code=400, detail="No driver IDs provided")
    drivers = db.scalars(select(Driver).where(Driver.id.in_(ids))).all()
    if len(drivers) != len(ids):
        raise HTTPException(status_code=400, detail="Some driver IDs do not exist")

    existing_ids = {
        row.driver_id
        for row in db.scalars(
            select(CompetitionDriver).where(CompetitionDriver.competition_id == competition_id)
        ).all()
    }
    added = 0
    for driver_id in ids:
        if driver_id in existing_ids:
            continue
        db.add(CompetitionDriver(competition_id=competition_id, driver_id=driver_id))
        added += 1
    db.commit()
    return {"competition_id": competition_id, "added_drivers": added}


@app.post("/competitions/{competition_id}/judges")
def assign_judges_to_competition(
    competition_id: int,
    payload: CompetitionJudgesAssign,
    db: Session = Depends(get_db),
):
    comp = get_competition_or_404(db, competition_id)
    if comp.status != "qualifying":
        raise HTTPException(status_code=400, detail="Can only modify competition before tournament starts")

    ids = sorted(set(payload.judge_ids))
    if not ids:
        raise HTTPException(status_code=400, detail="No judge IDs provided")
    judges = db.scalars(select(Judge).where(Judge.id.in_(ids))).all()
    if len(judges) != len(ids):
        raise HTTPException(status_code=400, detail="Some judge IDs do not exist")

    existing_ids = {
        row.judge_id
        for row in db.scalars(
            select(CompetitionJudge).where(CompetitionJudge.competition_id == competition_id)
        ).all()
    }
    added = 0
    for judge_id in ids:
        if judge_id in existing_ids:
            continue
        db.add(CompetitionJudge(competition_id=competition_id, judge_id=judge_id))
        added += 1
    db.commit()
    return {"competition_id": competition_id, "added_judges": added}


@app.post("/competitions/{competition_id}/qualifying/scores")
async def submit_qualifying_score(
    competition_id: int,
    payload: QualifyingScoreUpsert,
    db: Session = Depends(get_db),
):
    upsert_qualifying_score(
        db=db,
        competition_id=competition_id,
        driver_id=payload.driver_id,
        judge_id=payload.judge_id,
        run_number=payload.run_number,
        score=payload.score,
    )
    db.commit()

    leaderboard = qualifying_leaderboard(db, competition_id)
    await hub.broadcast(
        competition_id,
        {"type": "qualifying_leaderboard", "competition_id": competition_id, "leaderboard": leaderboard},
    )
    return {"competition_id": competition_id, "leaderboard": leaderboard}


@app.get("/competitions/{competition_id}/qualifying/leaderboard")
def get_qualifying_leaderboard(competition_id: int, db: Session = Depends(get_db)):
    return {
        "competition_id": competition_id,
        "leaderboard": qualifying_leaderboard(db, competition_id),
    }


@app.post("/competitions/{competition_id}/tournament/start")
async def start_competition_tournament(competition_id: int, db: Session = Depends(get_db)):
    result = start_tournament(db, competition_id)
    db.commit()

    await hub.broadcast(
        competition_id,
        {
            "type": "tournament_started",
            "competition_id": competition_id,
            "groups": result["groups"],
            "battles": list_competition_battles(db, competition_id),
        },
    )
    return result


@app.get("/competitions/{competition_id}/groups/{group_name}/standings")
def get_group_standings(competition_id: int, group_name: str, db: Session = Depends(get_db)):
    g = group_name.upper()
    if g not in {"A", "B"}:
        raise HTTPException(status_code=400, detail="Group must be A or B")
    return {"competition_id": competition_id, "group": g, "standings": group_standings(db, competition_id, g)}


@app.get("/competitions/{competition_id}/battles")
def get_battles(
    competition_id: int,
    stage: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    return {
        "competition_id": competition_id,
        "battles": list_competition_battles(db, competition_id, stage=stage),
    }


@app.get("/battles/{battle_id}")
def get_battle(battle_id: int, db: Session = Depends(get_db)):
    battle = get_battle_or_404(db, battle_id)
    return battle_state(db, battle)


@app.post("/battles/{battle_id}/scores")
async def submit_battle_score(
    battle_id: int,
    payload: BattleRunScoreUpsert,
    db: Session = Depends(get_db),
):
    result = upsert_battle_run_score(
        db=db,
        battle_id=battle_id,
        judge_id=payload.judge_id,
        omt_round=payload.omt_round,
        run_number=payload.run_number,
        driver1_points=payload.driver1_points,
        driver2_points=payload.driver2_points,
    )
    db.commit()

    battle = get_battle_or_404(db, battle_id)
    competition_id = battle.competition_id
    competition = get_competition_or_404(db, competition_id)
    payload_out: dict[str, Any] = {
        "type": "battle_update",
        "competition_id": competition_id,
        "battle": battle_state(db, battle),
        "battles": list_competition_battles(db, competition_id),
        "competition_status": competition.status,
    }
    if competition.status == "completed":
        payload_out["competition_standings"] = competition_driver_standings(db, competition_id)

    await hub.broadcast(competition_id, payload_out)
    return result


@app.post("/competitions/{competition_id}/progress")
def manual_progress(competition_id: int, db: Session = Depends(get_db)):
    result = try_progress_competition(db, competition_id)
    db.commit()
    return result


@app.get("/competitions/{competition_id}/standings")
def get_competition_standings(competition_id: int, db: Session = Depends(get_db)):
    comp = get_competition_or_404(db, competition_id)
    return {
        "competition_id": comp.id,
        "competition_name": comp.name,
        "status": comp.status,
        "standings": competition_driver_standings(db, competition_id),
    }


@app.websocket("/ws/competitions/{competition_id}/leaderboard")
async def competition_updates_ws(websocket: WebSocket, competition_id: int, db: Session = Depends(get_db)):
    get_competition_or_404(db, competition_id)
    await hub.connect(competition_id, websocket)
    try:
        await websocket.send_json(
            {
                "type": "bootstrap",
                "competition_id": competition_id,
                "qualifying_leaderboard": qualifying_leaderboard(db, competition_id),
                "battles": list_competition_battles(db, competition_id),
                "competition_standings": competition_driver_standings(db, competition_id),
            }
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(competition_id, websocket)
