from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


Pair = Tuple[int, int]
SCORE_DECIMALS = 2


@dataclass(frozen=True)
class RoundResolution:
    winner_slot: Optional[int]
    driver1_round_score: float
    driver2_round_score: float


def assign_groups_alternating(ordered_driver_ids: Sequence[int]) -> Dict[str, List[int]]:
    """
    Assign drivers to Group A/B in alternating qualifying order.
    Rank 1 -> A, Rank 2 -> B, Rank 3 -> A, ...
    """
    groups = {"A": [], "B": []}
    for idx, driver_id in enumerate(ordered_driver_ids):
        target = "A" if idx % 2 == 0 else "B"
        groups[target].append(driver_id)
    return groups


def build_round_robin_pairs(driver_ids: Sequence[int]) -> List[Pair]:
    """
    Generate all unique in-group battles (round robin).
    """
    return [(a, b) for a, b in combinations(driver_ids, 2)]


def order_battles_avoid_consecutive(pairs: Sequence[Pair]) -> List[Pair]:
    """
    Greedy ordering that avoids consecutive appearances when possible.
    If no perfect candidate exists, picks the pair with least overlap.
    """
    remaining: List[Pair] = list(pairs)
    if not remaining:
        return []

    ordered: List[Pair] = []
    last_drivers: set[int] = set()

    while remaining:
        # Prefer a pair with zero overlap vs. previous battle.
        ranked = sorted(
            enumerate(remaining),
            key=lambda item: (
                len(set(item[1]).intersection(last_drivers)),
                item[1][0],
                item[1][1],
            ),
        )
        best_idx = ranked[0][0]
        chosen = remaining.pop(best_idx)
        ordered.append(chosen)
        last_drivers = {chosen[0], chosen[1]}

    return ordered


def resolve_two_run_round(
    run1_driver1_avg: float,
    run1_driver2_avg: float,
    run2_driver1_avg: float,
    run2_driver2_avg: float,
) -> RoundResolution:
    """
    Winner is decided by average score across the 2 runs.
    Returns winner slot: 1, 2 or None (tie -> OMT).
    """
    driver1_round = round_score((run1_driver1_avg + run2_driver1_avg) / 2.0)
    driver2_round = round_score((run1_driver2_avg + run2_driver2_avg) / 2.0)

    if abs(driver1_round - driver2_round) < 1e-9:
        return RoundResolution(
            winner_slot=None,
            driver1_round_score=driver1_round,
            driver2_round_score=driver2_round,
        )

    winner_slot = 1 if driver1_round > driver2_round else 2
    return RoundResolution(
        winner_slot=winner_slot,
        driver1_round_score=driver1_round,
        driver2_round_score=driver2_round,
    )


def competition_points_for_place(place: int) -> int:
    if place == 1:
        return 100
    if place == 2:
        return 88
    if place == 3:
        return 76
    if place == 4:
        return 64
    if 5 <= place <= 8:
        return 48
    if 9 <= place <= 16:
        return 32
    if 17 <= place <= 32:
        return 16
    return 0


def qualifying_bonus_for_rank(rank: int) -> int:
    if rank == 1:
        return 3
    if rank == 2:
        return 2
    if rank == 3:
        return 1
    return 0


def total_after_drop_lowest_once(scores: Sequence[float]) -> float:
    """
    End-of-classification rule:
    remove exactly one occurrence of the lowest score if driver has >1 result.
    """
    if not scores:
        return 0.0
    if len(scores) == 1:
        return float(scores[0])
    return float(sum(scores) - min(scores))


def average(values: Iterable[float]) -> float:
    vals = list(values)
    if not vals:
        return 0.0
    return float(sum(vals) / len(vals))


def round_score(value: float) -> float:
    return round(float(value), SCORE_DECIMALS)
