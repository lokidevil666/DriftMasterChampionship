from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GlobalClassification(Base):
    __tablename__ = "global_classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    competitions: Mapped[list["Competition"]] = relationship(
        "Competition", back_populates="classification", cascade="all, delete-orphan"
    )


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    competition_entries: Mapped[list["CompetitionDriver"]] = relationship(
        "CompetitionDriver", back_populates="driver", cascade="all, delete-orphan"
    )


class Judge(Base):
    __tablename__ = "judges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    competition_entries: Mapped[list["CompetitionJudge"]] = relationship(
        "CompetitionJudge", back_populates="judge", cascade="all, delete-orphan"
    )


class Competition(Base):
    __tablename__ = "competitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    classification_id: Mapped[int] = mapped_column(
        ForeignKey("global_classifications.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(32), default="qualifying", nullable=False
    )  # qualifying, tournament, completed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    classification: Mapped[GlobalClassification] = relationship(
        "GlobalClassification", back_populates="competitions"
    )
    drivers: Mapped[list["CompetitionDriver"]] = relationship(
        "CompetitionDriver", back_populates="competition", cascade="all, delete-orphan"
    )
    judges: Mapped[list["CompetitionJudge"]] = relationship(
        "CompetitionJudge", back_populates="competition", cascade="all, delete-orphan"
    )
    qualifying_scores: Mapped[list["QualifyingScore"]] = relationship(
        "QualifyingScore", back_populates="competition", cascade="all, delete-orphan"
    )
    battles: Mapped[list["Battle"]] = relationship(
        "Battle", back_populates="competition", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("classification_id", "name", name="uq_competition_name_per_class"),)


class CompetitionDriver(Base):
    __tablename__ = "competition_drivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), nullable=False, index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False, index=True)
    group_name: Mapped[str | None] = mapped_column(String(1), nullable=True)  # A / B
    qualifying_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qualifying_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    final_place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    competition_points: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    qualifying_points: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_points: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    competition: Mapped[Competition] = relationship("Competition", back_populates="drivers")
    driver: Mapped[Driver] = relationship("Driver", back_populates="competition_entries")

    __table_args__ = (UniqueConstraint("competition_id", "driver_id", name="uq_competition_driver"),)


class CompetitionJudge(Base):
    __tablename__ = "competition_judges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), nullable=False, index=True)
    judge_id: Mapped[int] = mapped_column(ForeignKey("judges.id"), nullable=False, index=True)

    competition: Mapped[Competition] = relationship("Competition", back_populates="judges")
    judge: Mapped[Judge] = relationship("Judge", back_populates="competition_entries")

    __table_args__ = (UniqueConstraint("competition_id", "judge_id", name="uq_competition_judge"),)


class QualifyingScore(Base):
    __tablename__ = "qualifying_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), nullable=False, index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False, index=True)
    judge_id: Mapped[int] = mapped_column(ForeignKey("judges.id"), nullable=False, index=True)
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 or 2
    score: Mapped[float] = mapped_column(Float, nullable=False)  # 0-100
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    competition: Mapped[Competition] = relationship("Competition", back_populates="qualifying_scores")

    __table_args__ = (
        UniqueConstraint(
            "competition_id",
            "driver_id",
            "judge_id",
            "run_number",
            name="uq_qualifying_score",
        ),
    )


class Battle(Base):
    __tablename__ = "battles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # group, semifinal, third_place, final
    group_name: Mapped[str | None] = mapped_column(String(1), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    driver1_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False)
    driver2_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)  # pending/completed
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"), nullable=True)
    loser_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    competition: Mapped[Competition] = relationship("Competition", back_populates="battles")
    run_scores: Mapped[list["BattleRunScore"]] = relationship(
        "BattleRunScore", back_populates="battle", cascade="all, delete-orphan"
    )


class BattleRunScore(Base):
    __tablename__ = "battle_run_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    battle_id: Mapped[int] = mapped_column(ForeignKey("battles.id"), nullable=False, index=True)
    omt_round: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 or 2
    judge_id: Mapped[int] = mapped_column(ForeignKey("judges.id"), nullable=False, index=True)
    driver1_points: Mapped[float] = mapped_column(Float, nullable=False)  # 0-10
    driver2_points: Mapped[float] = mapped_column(Float, nullable=False)  # 0-10
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    battle: Mapped[Battle] = relationship("Battle", back_populates="run_scores")

    __table_args__ = (
        UniqueConstraint(
            "battle_id",
            "omt_round",
            "run_number",
            "judge_id",
            name="uq_battle_run_score",
        ),
    )
