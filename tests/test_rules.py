from app.rules import (
    assign_groups_alternating,
    competition_points_for_place,
    order_battles_avoid_consecutive,
    resolve_two_run_round,
    total_after_drop_lowest_once,
)


def test_assign_groups_alternating():
    groups = assign_groups_alternating([101, 102, 103, 104, 105, 106])
    assert groups["A"] == [101, 103, 105]
    assert groups["B"] == [102, 104, 106]


def test_order_battles_prefers_non_consecutive_when_available():
    pairs = [(1, 2), (3, 4), (1, 3)]
    ordered = order_battles_avoid_consecutive(pairs)
    assert ordered[0] == (1, 2)
    # A zero-overlap pair exists after (1,2), so it should be chosen.
    assert set(ordered[0]).intersection(set(ordered[1])) == set()


def test_resolve_two_run_round_winner_and_tie():
    winner = resolve_two_run_round(6.0, 4.0, 6.0, 4.0)
    assert winner.winner_slot == 1
    assert round(winner.driver1_round_score, 3) == 6.0
    assert round(winner.driver2_round_score, 3) == 4.0

    tie = resolve_two_run_round(5.0, 5.0, 5.0, 5.0)
    assert tie.winner_slot is None


def test_competition_points_scale():
    assert competition_points_for_place(1) == 100
    assert competition_points_for_place(2) == 88
    assert competition_points_for_place(3) == 76
    assert competition_points_for_place(4) == 64
    assert competition_points_for_place(5) == 48
    assert competition_points_for_place(8) == 48
    assert competition_points_for_place(9) == 32
    assert competition_points_for_place(16) == 32
    assert competition_points_for_place(17) == 16
    assert competition_points_for_place(32) == 16
    assert competition_points_for_place(33) == 0


def test_drop_lowest_once():
    assert total_after_drop_lowest_once([]) == 0.0
    assert total_after_drop_lowest_once([50.0]) == 50.0
    assert total_after_drop_lowest_once([50.0, 80.0, 80.0]) == 160.0
