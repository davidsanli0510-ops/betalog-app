"""Database tables. Times are epoch milliseconds, as sent by the phones."""
from sqlalchemy import BigInteger, Boolean, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(30))
    username_lower: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    display_name: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[int] = mapped_column(BigInteger)


class Problem(Base):
    """A problem a climber recorded. The id is a UUID made on the phone, so phones can work offline."""
    __tablename__ = "problems"
    __table_args__ = (Index("idx_problems_user_seq", "user_id", "server_updated_at"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    gym: Mapped[str] = mapped_column(String(20))
    grade: Mapped[int] = mapped_column(Integer)
    sector: Mapped[str] = mapped_column(String(40), default="")
    memo: Mapped[str] = mapped_column(String(2000), default="")
    marks: Mapped[str] = mapped_column(Text, default="[]")  # hold sequence as JSON [{x,y}] in % of the photo
    has_photo: Mapped[bool] = mapped_column(Boolean, default=False)
    video_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)  # last edit on the phone; newest edit wins
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    server_updated_at: Mapped[int] = mapped_column(BigInteger)  # change counter phones pull "since"


class Attempt(Base):
    """One logged session on a problem: how many tries and the outcome."""
    __tablename__ = "attempts"
    __table_args__ = (Index("idx_attempts_user_seq", "user_id", "server_updated_at"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    problem_id: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer)
    result: Mapped[str] = mapped_column(String(10))  # FLASH | SEND | PROJECT
    attempt_date: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    server_updated_at: Mapped[int] = mapped_column(BigInteger)
