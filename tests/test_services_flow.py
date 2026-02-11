from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Competition, CompetitionDriver, CompetitionJudge, Driver, GlobalClassification, Judge
from app.services import (
    competition_driver_standings,
    list_competition_battles,
    start_tournament,
    upsert_battle_run_score,
    upsert_qualifying_score,
)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=True, autocommit=False)
    return SessionLocal()


def test_competition_progresses_to_completed():
    db = _session()

    cls = GlobalClassification(name="RMDS_2026")
    db.add(cls)
    db.flush()
    comp = Competition(name="Round_1", classification_id=cls.id)
    db.add(comp)
    db.flush()

    drivers = []
    for i in range(1, 5):
        d = Driver(name=f"Driver {i}", number=i)
        db.add(d)
        db.flush()
        db.add(CompetitionDriver(competition_id=comp.id, driver_id=d.id))
        drivers.append(d)

    judges = []
    for i in range(1, 3):
        j = Judge(name=f"Judge {i}")
        db.add(j)
        db.flush()
        db.add(CompetitionJudge(competition_id=comp.id, judge_id=j.id))
        judges.append(j)

    db.commit()

    # Complete qualifying with descending scores.
    score = 90.0
    for d in drivers:
        for j in judges:
            for run in (1, 2):
                upsert_qualifying_score(db, comp.id, d.id, j.id, run, score)
        score -= 5
    db.commit()

    start_tournament(db, comp.id)
    db.commit()

    # Resolve all battles by giving driver1 a clear advantage.
    for _ in range(6):
        battles = list_competition_battles(db, comp.id)
        pending = [b for b in battles if b["status"] == "pending"]
        if not pending:
            break
        for b in pending:
            for j in judges:
                for run in (1, 2):
                    upsert_battle_run_score(db, b["id"], j.id, 0, run, 6.0, 4.0)
            db.commit()

    comp = db.get(Competition, comp.id)
    assert comp is not None
    assert comp.status == "completed"

    standings = competition_driver_standings(db, comp.id)
    places = sorted(s["final_place"] for s in standings if s["final_place"] is not None)
    assert places[:4] == [1, 2, 3, 4]

    db.close()
