from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Competition, CompetitionDriver, CompetitionJudge, Driver, GlobalClassification, Judge
from app.services import qualifying_leaderboard, upsert_qualifying_score


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=True, autocommit=False)
    return SessionLocal()


def test_qualifying_uses_best_run_not_average():
    db = _session()

    cls = GlobalClassification(name="RMDS_2026")
    db.add(cls)
    db.flush()
    comp = Competition(name="Round_1", classification_id=cls.id)
    db.add(comp)
    db.flush()

    d1 = Driver(name="Driver One", number=1)
    d2 = Driver(name="Driver Two", number=2)
    db.add(d1)
    db.add(d2)
    db.flush()

    j1 = Judge(name="Judge 1")
    j2 = Judge(name="Judge 2")
    db.add(j1)
    db.add(j2)
    db.flush()

    db.add(CompetitionDriver(competition_id=comp.id, driver_id=d1.id))
    db.add(CompetitionDriver(competition_id=comp.id, driver_id=d2.id))
    db.add(CompetitionJudge(competition_id=comp.id, judge_id=j1.id))
    db.add(CompetitionJudge(competition_id=comp.id, judge_id=j2.id))
    db.commit()

    # Driver 1: run1 avg=95, run2 avg=80 => qualifying should be 95 (best run)
    upsert_qualifying_score(db, comp.id, d1.id, j1.id, 1, 95)
    upsert_qualifying_score(db, comp.id, d1.id, j2.id, 1, 95)
    upsert_qualifying_score(db, comp.id, d1.id, j1.id, 2, 80)
    upsert_qualifying_score(db, comp.id, d1.id, j2.id, 2, 80)

    # Driver 2: run1 avg=90, run2 avg=89 => qualifying should be 90
    upsert_qualifying_score(db, comp.id, d2.id, j1.id, 1, 90)
    upsert_qualifying_score(db, comp.id, d2.id, j2.id, 1, 90)
    upsert_qualifying_score(db, comp.id, d2.id, j1.id, 2, 89)
    upsert_qualifying_score(db, comp.id, d2.id, j2.id, 2, 89)
    db.commit()

    board = qualifying_leaderboard(db, comp.id)
    assert board[0]["driver_id"] == d1.id
    assert board[0]["qualifying_score"] == 95.0
    assert board[1]["driver_id"] == d2.id
    assert board[1]["qualifying_score"] == 90.0
    assert all(item["is_complete"] for item in board)

    db.close()
