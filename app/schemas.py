from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class GlobalClassificationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class CompetitionCreate(BaseModel):
    classification_id: int
    name: str = Field(min_length=1, max_length=128)


class DriverCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    number: int = Field(ge=1)


class JudgeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class CompetitionDriversAssign(BaseModel):
    driver_ids: list[int]


class CompetitionJudgesAssign(BaseModel):
    judge_ids: list[int]


class QualifyingScoreUpsert(BaseModel):
    driver_id: int
    judge_id: int
    run_number: int = Field(ge=1, le=2)
    score: float = Field(ge=0, le=100)


class BattleRunScoreUpsert(BaseModel):
    judge_id: int
    omt_round: int = Field(ge=0)
    run_number: int = Field(ge=1, le=2)
    driver1_points: float = Field(ge=0, le=10)
    driver2_points: float = Field(ge=0, le=10)


class BattleResultOut(BaseModel):
    id: int
    stage: str
    group_name: Optional[str] = None
    order_index: int
    driver1_id: int
    driver2_id: int
    status: str
    winner_id: Optional[int] = None
    loser_id: Optional[int] = None
    current_omt_round: int
    next_required_omt_round: int


class CompetitionDriverStandingOut(BaseModel):
    driver_id: int
    driver_name: str
    driver_number: int
    qualifying_rank: Optional[int] = None
    qualifying_score: float
    group_name: Optional[str] = None
    final_place: Optional[int] = None
    competition_points: float
    qualifying_points: float
    total_points: float
