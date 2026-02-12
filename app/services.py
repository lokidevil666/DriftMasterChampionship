from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Battle,
    BattleRunScore,
    Competition,
    CompetitionDriver,
    CompetitionJudge,
    Driver,
    GlobalClassification,
    Judge,
    QualifyingScore,
)
from app.rules import (
    assign_groups_alternating,
    average,
    build_round_robin_pairs,
    competition_points_for_place,
    order_battles_avoid_consecutive,
    qualifying_bonus_for_rank,
    resolve_two_run_round,
    round_score,
    total_after_drop_lowest_once,
)


def get_or_404(db: Session, model: Any, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return obj


def get_classification_or_404(db: Session, classification_id: int) -> GlobalClassification:
    return get_or_404(db, GlobalClassification, classification_id, "Classification")


def get_competition_or_404(db: Session, competition_id: int) -> Competition:
    return get_or_404(db, Competition, competition_id, "Competition")


def get_battle_or_404(db: Session, battle_id: int) -> Battle:
    return get_or_404(db, Battle, battle_id, "Battle")


def require_open_classification(classification: GlobalClassification) -> None:
    if classification.is_closed:
        raise HTTPException(status_code=400, detail="Classification is closed")


def competition_driver_ids(db: Session, competition_id: int) -> set[int]:
    rows = db.scalars(
        select(CompetitionDriver.driver_id).where(CompetitionDriver.competition_id == competition_id)
    ).all()
    return set(rows)


def competition_judge_ids(db: Session, competition_id: int) -> set[int]:
    rows = db.scalars(
        select(CompetitionJudge.judge_id).where(CompetitionJudge.competition_id == competition_id)
    ).all()
    return set(rows)


def upsert_qualifying_score(
    db: Session,
    competition_id: int,
    driver_id: int,
    judge_id: int,
    run_number: int,
    score: float,
) -> QualifyingScore:
    competition = get_competition_or_404(db, competition_id)
    if competition.status != "qualifying":
        raise HTTPException(
            status_code=400,
            detail="Qualifying scores can only be submitted before tournament starts",
        )

    driver_ids = competition_driver_ids(db, competition_id)
    if driver_id not in driver_ids:
        raise HTTPException(status_code=400, detail="Driver is not registered in this competition")
    judge_ids = competition_judge_ids(db, competition_id)
    if judge_id not in judge_ids:
        raise HTTPException(status_code=400, detail="Judge is not assigned to this competition")

    score = round_score(score)

    existing = db.scalar(
        select(QualifyingScore).where(
            QualifyingScore.competition_id == competition_id,
            QualifyingScore.driver_id == driver_id,
            QualifyingScore.judge_id == judge_id,
            QualifyingScore.run_number == run_number,
        )
    )
    if existing:
        existing.score = score
        return existing

    created = QualifyingScore(
        competition_id=competition_id,
        driver_id=driver_id,
        judge_id=judge_id,
        run_number=run_number,
        score=score,
    )
    db.add(created)
    return created


def qualifying_leaderboard(db: Session, competition_id: int) -> list[dict[str, Any]]:
    competition = get_competition_or_404(db, competition_id)
    driver_entries = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id == competition.id)
    ).all()
    judge_count = len(competition_judge_ids(db, competition_id))

    driver_map = {entry.driver_id: entry for entry in driver_entries}
    driver_ids = list(driver_map.keys())
    if not driver_ids:
        return []

    drivers = {
        d.id: d
        for d in db.scalars(select(Driver).where(Driver.id.in_(driver_ids))).all()
    }

    score_rows = db.scalars(
        select(QualifyingScore).where(QualifyingScore.competition_id == competition_id)
    ).all()

    run_scores: dict[int, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in score_rows:
        run_scores[row.driver_id][row.run_number].append(row.score)

    items: list[dict[str, Any]] = []
    for driver_id in driver_ids:
        d = drivers[driver_id]
        run1_values = run_scores[driver_id][1]
        run2_values = run_scores[driver_id][2]
        run1_avg = round_score(average(run1_values)) if run1_values else 0.0
        run2_avg = round_score(average(run2_values)) if run2_values else 0.0
        present_avgs = [
            v
            for v in [run1_avg if run1_values else None, run2_avg if run2_values else None]
            if v is not None
        ]
        # Qualifying result is the best run out of the two runs.
        total = max(present_avgs) if present_avgs else 0.0
        second_best = min(present_avgs) if len(present_avgs) == 2 else 0.0

        is_complete = (
            judge_count > 0
            and len(run1_values) == judge_count
            and len(run2_values) == judge_count
        )
        items.append(
            {
                "driver_id": driver_id,
                "driver_name": d.name,
                "driver_number": d.number,
                "run1_avg": round_score(run1_avg),
                "run2_avg": round_score(run2_avg),
                "qualifying_score": round_score(total),
                "second_best_run": round_score(second_best),
                "is_complete": is_complete,
            }
        )

    items.sort(
        key=lambda x: (
            -x["qualifying_score"],
            -x["second_best_run"],
            -x["run2_avg"],
            -x["run1_avg"],
            x["driver_number"],
        )
    )
    for idx, row in enumerate(items, start=1):
        row["rank"] = idx
    return items


def qualifying_is_complete(db: Session, competition_id: int) -> bool:
    competition = get_competition_or_404(db, competition_id)
    judge_ids = competition_judge_ids(db, competition_id)
    if not judge_ids:
        return False
    entries = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id == competition.id)
    ).all()
    if not entries:
        return False
    lb = qualifying_leaderboard(db, competition_id)
    return all(item["is_complete"] for item in lb)


def start_tournament(db: Session, competition_id: int) -> dict[str, Any]:
    competition = get_competition_or_404(db, competition_id)
    if competition.status == "completed":
        raise HTTPException(status_code=400, detail="Competition already completed")
    if competition.status == "tournament":
        raise HTTPException(status_code=400, detail="Tournament already started")

    lb = qualifying_leaderboard(db, competition_id)
    if len(lb) < 4:
        raise HTTPException(
            status_code=400,
            detail="At least 4 drivers are required to start tournament",
        )
    if not all(row["is_complete"] for row in lb):
        raise HTTPException(status_code=400, detail="Qualifying is not complete")

    ordered_driver_ids = [row["driver_id"] for row in lb]
    groups = assign_groups_alternating(ordered_driver_ids)
    if len(groups["A"]) < 2 or len(groups["B"]) < 2:
        raise HTTPException(
            status_code=400,
            detail="Need at least 2 drivers in each group for semifinals",
        )

    entries = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id == competition_id)
    ).all()
    entry_by_driver = {e.driver_id: e for e in entries}

    for rank, row in enumerate(lb, start=1):
        entry = entry_by_driver[row["driver_id"]]
        entry.qualifying_rank = rank
        entry.qualifying_score = row["qualifying_score"]
        entry.group_name = "A" if row["driver_id"] in groups["A"] else "B"

    # Build group battles with best-effort non-consecutive order.
    created_battles = 0
    for group_name in ["A", "B"]:
        pairs = build_round_robin_pairs(groups[group_name])
        ordered_pairs = order_battles_avoid_consecutive(pairs)
        for idx, (driver1_id, driver2_id) in enumerate(ordered_pairs, start=1):
            db.add(
                Battle(
                    competition_id=competition_id,
                    stage="group",
                    group_name=group_name,
                    order_index=idx,
                    driver1_id=driver1_id,
                    driver2_id=driver2_id,
                )
            )
            created_battles += 1

    competition.status = "tournament"
    return {"groups": groups, "created_group_battles": created_battles}


def battle_current_omt_round(db: Session, battle_id: int) -> int:
    value = db.scalar(
        select(func.max(BattleRunScore.omt_round)).where(BattleRunScore.battle_id == battle_id)
    )
    return int(value) if value is not None else 0


@dataclass
class RoundAverages:
    run1_driver1: float
    run1_driver2: float
    run2_driver1: float
    run2_driver2: float
    complete: bool


def _round_averages(db: Session, battle: Battle, omt_round: int) -> RoundAverages:
    rows = db.scalars(
        select(BattleRunScore).where(
            BattleRunScore.battle_id == battle.id,
            BattleRunScore.omt_round == omt_round,
        )
    ).all()
    if not rows:
        return RoundAverages(0.0, 0.0, 0.0, 0.0, False)

    judges_needed = len(competition_judge_ids(db, battle.competition_id))
    run_map: dict[int, list[BattleRunScore]] = defaultdict(list)
    for row in rows:
        run_map[row.run_number].append(row)

    run1_rows = run_map.get(1, [])
    run2_rows = run_map.get(2, [])
    if len(run1_rows) != judges_needed or len(run2_rows) != judges_needed:
        return RoundAverages(0.0, 0.0, 0.0, 0.0, False)

    run1_driver1 = average(r.driver1_points for r in run1_rows)
    run1_driver2 = average(r.driver2_points for r in run1_rows)
    run2_driver1 = average(r.driver1_points for r in run2_rows)
    run2_driver2 = average(r.driver2_points for r in run2_rows)
    return RoundAverages(
        run1_driver1=run1_driver1,
        run1_driver2=run1_driver2,
        run2_driver1=run2_driver1,
        run2_driver2=run2_driver2,
        complete=True,
    )


def battle_state(db: Session, battle: Battle) -> dict[str, Any]:
    current_round = battle_current_omt_round(db, battle.id)
    round_data = _round_averages(db, battle, current_round)

    next_round = current_round
    if round_data.complete and battle.status != "completed":
        resolution = resolve_two_run_round(
            round_data.run1_driver1,
            round_data.run1_driver2,
            round_data.run2_driver1,
            round_data.run2_driver2,
        )
        if resolution.winner_slot is None:
            next_round = current_round + 1

    return {
        "id": battle.id,
        "stage": battle.stage,
        "group_name": battle.group_name,
        "order_index": battle.order_index,
        "driver1_id": battle.driver1_id,
        "driver2_id": battle.driver2_id,
        "status": battle.status,
        "winner_id": battle.winner_id,
        "loser_id": battle.loser_id,
        "current_omt_round": current_round,
        "next_required_omt_round": next_round,
    }


def _all_battles_completed(
    db: Session, competition_id: int, stage: str, group_name: Optional[str] = None
) -> bool:
    conditions = [Battle.competition_id == competition_id, Battle.stage == stage]
    if group_name is not None:
        conditions.append(Battle.group_name == group_name)
    rows = db.scalars(select(Battle).where(*conditions)).all()
    if not rows:
        return False
    return all(r.status == "completed" for r in rows)


def _has_stage(db: Session, competition_id: int, stage: str) -> bool:
    return (
        db.scalar(
            select(func.count(Battle.id)).where(
                Battle.competition_id == competition_id, Battle.stage == stage
            )
        )
        or 0
    ) > 0


def _battle_decisive_round_scores(db: Session, battle: Battle) -> tuple[float, float]:
    if battle.status != "completed":
        return 0.0, 0.0
    current_round = battle_current_omt_round(db, battle.id)
    round_data = _round_averages(db, battle, current_round)
    if not round_data.complete:
        return 0.0, 0.0
    resolution = resolve_two_run_round(
        round_data.run1_driver1,
        round_data.run1_driver2,
        round_data.run2_driver1,
        round_data.run2_driver2,
    )
    return resolution.driver1_round_score, resolution.driver2_round_score


def group_standings(db: Session, competition_id: int, group_name: str) -> list[dict[str, Any]]:
    entries = db.scalars(
        select(CompetitionDriver).where(
            CompetitionDriver.competition_id == competition_id,
            CompetitionDriver.group_name == group_name,
        )
    ).all()
    if not entries:
        return []

    drivers = {d.id: d for d in db.scalars(select(Driver).where(Driver.id.in_([e.driver_id for e in entries]))).all()}
    stats: dict[int, dict[str, Any]] = {}
    for entry in entries:
        d = drivers[entry.driver_id]
        stats[entry.driver_id] = {
            "driver_id": entry.driver_id,
            "driver_name": d.name,
            "driver_number": d.number,
            "wins": 0,
            "losses": 0,
            "points_for": 0.0,
            "points_against": 0.0,
            "qualifying_rank": entry.qualifying_rank or 9999,
        }

    battles = db.scalars(
        select(Battle).where(
            Battle.competition_id == competition_id,
            Battle.stage == "group",
            Battle.group_name == group_name,
        )
    ).all()
    for battle in battles:
        if battle.status != "completed" or not battle.winner_id or not battle.loser_id:
            continue
        stats[battle.winner_id]["wins"] += 1
        stats[battle.loser_id]["losses"] += 1
        d1_score, d2_score = _battle_decisive_round_scores(db, battle)
        stats[battle.driver1_id]["points_for"] += d1_score
        stats[battle.driver1_id]["points_against"] += d2_score
        stats[battle.driver2_id]["points_for"] += d2_score
        stats[battle.driver2_id]["points_against"] += d1_score

    ranked = list(stats.values())
    ranked.sort(
        key=lambda s: (
            -s["wins"],
            -(s["points_for"] - s["points_against"]),
            -s["points_for"],
            s["qualifying_rank"],
            s["driver_number"],
        )
    )
    for idx, row in enumerate(ranked, start=1):
        row["rank"] = idx
        row["point_diff"] = round_score(row["points_for"] - row["points_against"])
        row["points_for"] = round_score(row["points_for"])
        row["points_against"] = round_score(row["points_against"])
    return ranked


def _try_create_semifinals(db: Session, competition: Competition) -> bool:
    if _has_stage(db, competition.id, "semifinal"):
        return False
    if not _all_battles_completed(db, competition.id, "group", "A"):
        return False
    if not _all_battles_completed(db, competition.id, "group", "B"):
        return False

    group_a = group_standings(db, competition.id, "A")
    group_b = group_standings(db, competition.id, "B")
    if len(group_a) < 2 or len(group_b) < 2:
        return False

    # SF1: A1 vs B2; SF2: B1 vs A2
    db.add(
        Battle(
            competition_id=competition.id,
            stage="semifinal",
            group_name=None,
            order_index=1,
            driver1_id=group_a[0]["driver_id"],
            driver2_id=group_b[1]["driver_id"],
        )
    )
    db.add(
        Battle(
            competition_id=competition.id,
            stage="semifinal",
            group_name=None,
            order_index=2,
            driver1_id=group_b[0]["driver_id"],
            driver2_id=group_a[1]["driver_id"],
        )
    )
    return True


def _try_create_final_and_third_place(db: Session, competition: Competition) -> bool:
    if not _has_stage(db, competition.id, "semifinal"):
        return False
    if not _all_battles_completed(db, competition.id, "semifinal"):
        return False
    if _has_stage(db, competition.id, "final") or _has_stage(db, competition.id, "third_place"):
        return False

    semis = db.scalars(
        select(Battle).where(
            Battle.competition_id == competition.id,
            Battle.stage == "semifinal",
        ).order_by(Battle.order_index.asc())
    ).all()
    if len(semis) != 2:
        return False
    if not all(s.winner_id and s.loser_id for s in semis):
        return False

    db.add(
        Battle(
            competition_id=competition.id,
            stage="third_place",
            group_name=None,
            order_index=1,
            driver1_id=semis[0].loser_id,
            driver2_id=semis[1].loser_id,
        )
    )
    db.add(
        Battle(
            competition_id=competition.id,
            stage="final",
            group_name=None,
            order_index=1,
            driver1_id=semis[0].winner_id,
            driver2_id=semis[1].winner_id,
        )
    )
    return True


def _remaining_order_after_top4(db: Session, competition_id: int, excluded_driver_ids: set[int]) -> list[int]:
    standings_a = group_standings(db, competition_id, "A")
    standings_b = group_standings(db, competition_id, "B")
    merged = [row for row in standings_a + standings_b if row["driver_id"] not in excluded_driver_ids]
    merged.sort(key=lambda x: (x["rank"], x["qualifying_rank"], x["driver_number"]))
    return [row["driver_id"] for row in merged]


def _finalize_competition_if_ready(db: Session, competition: Competition) -> bool:
    if competition.status == "completed":
        return False
    if not _all_battles_completed(db, competition.id, "final"):
        return False
    if not _all_battles_completed(db, competition.id, "third_place"):
        return False

    final_battle = db.scalar(
        select(Battle).where(
            Battle.competition_id == competition.id,
            Battle.stage == "final",
        )
    )
    third_battle = db.scalar(
        select(Battle).where(
            Battle.competition_id == competition.id,
            Battle.stage == "third_place",
        )
    )
    if not final_battle or not third_battle:
        return False
    if not all([final_battle.winner_id, final_battle.loser_id, third_battle.winner_id, third_battle.loser_id]):
        return False

    place_map: dict[int, int] = {
        final_battle.winner_id: 1,
        final_battle.loser_id: 2,
        third_battle.winner_id: 3,
        third_battle.loser_id: 4,
    }
    taken = set(place_map.keys())
    remainder = _remaining_order_after_top4(db, competition.id, taken)
    next_place = 5
    for driver_id in remainder:
        place_map[driver_id] = next_place
        next_place += 1

    entries = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id == competition.id)
    ).all()
    for entry in entries:
        if entry.driver_id not in place_map:
            continue
        place = place_map[entry.driver_id]
        q_rank = entry.qualifying_rank or 9999
        q_bonus = qualifying_bonus_for_rank(q_rank)
        q_points = round_score(entry.qualifying_score + q_bonus)
        c_points = round_score(competition_points_for_place(place))
        entry.final_place = place
        entry.competition_points = c_points
        entry.qualifying_points = q_points
        entry.total_points = round_score(c_points + q_points)

    competition.status = "completed"
    return True


def try_progress_competition(db: Session, competition_id: int) -> dict[str, bool]:
    competition = get_competition_or_404(db, competition_id)
    created_semis = _try_create_semifinals(db, competition)
    created_finals = _try_create_final_and_third_place(db, competition)
    finalized = _finalize_competition_if_ready(db, competition)
    return {
        "created_semifinals": created_semis,
        "created_finals": created_finals,
        "finalized_competition": finalized,
    }


def upsert_battle_run_score(
    db: Session,
    battle_id: int,
    judge_id: int,
    omt_round: int,
    run_number: int,
    driver1_points: float,
    driver2_points: float,
) -> dict[str, Any]:
    battle = get_battle_or_404(db, battle_id)
    if battle.status == "completed":
        raise HTTPException(status_code=400, detail="Battle already completed")
    driver1_points = round_score(driver1_points)
    driver2_points = round_score(driver2_points)
    if abs((driver1_points + driver2_points) - 10.0) > 1e-9:
        raise HTTPException(status_code=400, detail="Judge points must sum to exactly 10")

    judge_ids = competition_judge_ids(db, battle.competition_id)
    if judge_id not in judge_ids:
        raise HTTPException(status_code=400, detail="Judge not assigned to battle competition")

    current = battle_current_omt_round(db, battle.id)
    current_round_data = _round_averages(db, battle, current)
    if current_round_data.complete:
        # If current round has a winner, battle should already be marked complete; if tie, allow next OMT.
        resolution = resolve_two_run_round(
            current_round_data.run1_driver1,
            current_round_data.run1_driver2,
            current_round_data.run2_driver1,
            current_round_data.run2_driver2,
        )
        max_allowed = current + 1 if resolution.winner_slot is None else current
    else:
        max_allowed = current

    if omt_round > max_allowed:
        raise HTTPException(
            status_code=400,
            detail=f"OMT round {omt_round} is not open yet. Next available is {max_allowed}",
        )

    existing = db.scalar(
        select(BattleRunScore).where(
            BattleRunScore.battle_id == battle.id,
            BattleRunScore.omt_round == omt_round,
            BattleRunScore.run_number == run_number,
            BattleRunScore.judge_id == judge_id,
        )
    )
    if existing:
        existing.driver1_points = driver1_points
        existing.driver2_points = driver2_points
    else:
        db.add(
            BattleRunScore(
                battle_id=battle.id,
                omt_round=omt_round,
                run_number=run_number,
                judge_id=judge_id,
                driver1_points=driver1_points,
                driver2_points=driver2_points,
            )
        )

    # Ensure round queries include this write in the current request.
    db.flush()

    # Try to settle the submitted round.
    round_data = _round_averages(db, battle, omt_round)
    if round_data.complete:
        resolution = resolve_two_run_round(
            round_data.run1_driver1,
            round_data.run1_driver2,
            round_data.run2_driver1,
            round_data.run2_driver2,
        )
        if resolution.winner_slot is not None:
            if resolution.winner_slot == 1:
                battle.winner_id = battle.driver1_id
                battle.loser_id = battle.driver2_id
            else:
                battle.winner_id = battle.driver2_id
                battle.loser_id = battle.driver1_id
            battle.status = "completed"

    progression = try_progress_competition(db, battle.competition_id)
    return {"battle": battle_state(db, battle), "progression": progression}


def list_competition_battles(
    db: Session, competition_id: int, stage: Optional[str] = None
) -> list[dict[str, Any]]:
    get_competition_or_404(db, competition_id)
    query = select(Battle).where(Battle.competition_id == competition_id)
    if stage:
        query = query.where(Battle.stage == stage)
    rows = db.scalars(
        query.order_by(Battle.stage.asc(), Battle.group_name.asc(), Battle.order_index.asc(), Battle.id.asc())
    ).all()
    return [battle_state(db, b) for b in rows]


def competition_driver_standings(db: Session, competition_id: int) -> list[dict[str, Any]]:
    get_competition_or_404(db, competition_id)
    entries = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id == competition_id)
    ).all()
    if not entries:
        return []
    driver_ids = [e.driver_id for e in entries]
    drivers = {d.id: d for d in db.scalars(select(Driver).where(Driver.id.in_(driver_ids))).all()}

    rows: list[dict[str, Any]] = []
    for e in entries:
        d = drivers[e.driver_id]
        rows.append(
            {
                "driver_id": e.driver_id,
                "driver_name": d.name,
                "driver_number": d.number,
                "qualifying_rank": e.qualifying_rank,
                "qualifying_score": round_score(e.qualifying_score),
                "group_name": e.group_name,
                "final_place": e.final_place,
                "competition_points": round_score(e.competition_points),
                "qualifying_points": round_score(e.qualifying_points),
                "total_points": round_score(e.total_points),
            }
        )
    rows.sort(
        key=lambda r: (
            r["final_place"] if r["final_place"] is not None else 9999,
            r["qualifying_rank"] if r["qualifying_rank"] is not None else 9999,
            r["driver_number"],
        )
    )
    return rows


def global_classification_standings(db: Session, classification_id: int) -> list[dict[str, Any]]:
    classification = get_classification_or_404(db, classification_id)
    completed_competitions = db.scalars(
        select(Competition).where(
            Competition.classification_id == classification.id,
            Competition.status == "completed",
        )
    ).all()
    if not completed_competitions:
        return []

    competition_ids = [c.id for c in completed_competitions]
    entries = db.scalars(
        select(CompetitionDriver).where(CompetitionDriver.competition_id.in_(competition_ids))
    ).all()
    if not entries:
        return []

    per_driver_scores: dict[int, list[float]] = defaultdict(list)
    per_driver_detail: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for e in entries:
        per_driver_scores[e.driver_id].append(float(e.total_points))
        per_driver_detail[e.driver_id].append(
            {
                "competition_id": e.competition_id,
                "points": round_score(float(e.total_points)),
                "place": e.final_place,
            }
        )

    drivers = {d.id: d for d in db.scalars(select(Driver).where(Driver.id.in_(per_driver_scores.keys()))).all()}
    rows: list[dict[str, Any]] = []
    for driver_id, scores in per_driver_scores.items():
        raw_total = float(sum(scores))
        applied_total = (
            total_after_drop_lowest_once(scores) if classification.is_closed else raw_total
        )
        d = drivers[driver_id]
        rows.append(
            {
                "driver_id": driver_id,
                "driver_name": d.name,
                "driver_number": d.number,
                "competitions_count": len(scores),
                "raw_total_points": round_score(raw_total),
                "effective_total_points": round_score(applied_total),
                "drop_lowest_applied": classification.is_closed and len(scores) > 1,
                "competition_breakdown": sorted(
                    per_driver_detail[driver_id], key=lambda i: i["competition_id"]
                ),
            }
        )

    rows.sort(
        key=lambda r: (
            -r["effective_total_points"],
            -r["raw_total_points"],
            r["driver_number"],
        )
    )
    for idx, row in enumerate(rows, start=1):
        row["rank"] = idx
    return rows
