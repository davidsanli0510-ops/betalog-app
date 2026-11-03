"""Offline-first sync.

Phones push the rows they changed and pull the rows that changed after their cursor.
When two phones edit the same row, the edit with the newer phone timestamp (updatedAt) wins.
Deletes travel as rows with deleted=true. Nobody can touch another user's rows.
"""
import threading
import time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Attempt, Problem
from .schemas import AttemptDto, ProblemDto, SyncRequest, SyncResponse

MAX_BATCH = 2000
RESULTS = {"FLASH", "SEND", "PROJECT"}


class BadRequest(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class Sequence:
    """Monotonic change counter based on wall time, so it keeps increasing across restarts."""

    def __init__(self, start: int = 0):
        self._last = start
        self._lock = threading.Lock()

    def next(self) -> int:
        with self._lock:
            self._last = max(self._last + 1, int(time.time() * 1000))
            return self._last


def current_max_seq(db: Session) -> int:
    p = db.scalar(select(func.coalesce(func.max(Problem.server_updated_at), 0))) or 0
    a = db.scalar(select(func.coalesce(func.max(Attempt.server_updated_at), 0))) or 0
    return max(int(p), int(a))


def _clip(s, n):
    s = s or ""
    return s[:n]


def _check_problem(d: ProblemDto):
    if not d.id or len(d.id) > 64:
        raise BadRequest("문제 ID가 올바르지 않아요.")
    if not d.gym or len(d.gym) > 20:
        raise BadRequest("지점 값이 올바르지 않아요.")
    if d.grade < 0 or d.grade > 30:
        raise BadRequest("난이도 값이 올바르지 않아요.")


def _check_attempt(d: AttemptDto):
    if not d.id or len(d.id) > 64:
        raise BadRequest("기록 ID가 올바르지 않아요.")
    if not d.problemId or len(d.problemId) > 64:
        raise BadRequest("기록의 문제 ID가 올바르지 않아요.")
    if d.attempts < 1 or d.attempts > 9999:
        raise BadRequest("시도 횟수가 올바르지 않아요.")
    if d.result not in RESULTS:
        raise BadRequest("결과 값이 올바르지 않아요.")


def problem_dto(e: Problem) -> ProblemDto:
    return ProblemDto(id=e.id, gym=e.gym, grade=e.grade, sector=e.sector, memo=e.memo, createdAt=e.created_at, updatedAt=e.updated_at,
                      deleted=e.deleted, marks=e.marks, hasPhoto=e.has_photo, videoCount=e.video_count)


def attempt_dto(e: Attempt) -> AttemptDto:
    return AttemptDto(id=e.id, problemId=e.problem_id, attempts=e.attempts, result=e.result, date=e.attempt_date,
                      updatedAt=e.updated_at, deleted=e.deleted)


def sync(db: Session, seq: Sequence, user_id: int, req: SyncRequest) -> SyncResponse:
    if len(req.problems) + len(req.attempts) > MAX_BATCH:
        raise BadRequest("한 번에 올릴 변경이 너무 많아요.", 413)
    for d in req.problems:
        _check_problem(d)
    for d in req.attempts:
        _check_attempt(d)

    for d in req.problems:
        e = db.get(Problem, d.id)
        if e is not None and (e.user_id != user_id or d.updatedAt < e.updated_at):
            continue  # someone else's row, or the server already has a newer edit
        if e is None:
            e = Problem(id=d.id, user_id=user_id)
            db.add(e)
        e.gym = d.gym
        e.grade = d.grade
        e.sector = _clip(d.sector, 40)
        e.memo = _clip(d.memo, 2000)
        e.marks = d.marks if d.marks and len(d.marks) <= 8000 else "[]"
        e.has_photo = d.hasPhoto
        e.video_count = max(0, d.videoCount)
        e.created_at = d.createdAt
        e.updated_at = d.updatedAt
        e.deleted = d.deleted
        e.server_updated_at = seq.next()
    db.flush()

    for d in req.attempts:
        e = db.get(Attempt, d.id)
        if e is not None and (e.user_id != user_id or d.updatedAt < e.updated_at):
            continue
        parent = db.get(Problem, d.problemId)
        if parent is not None and parent.user_id != user_id:
            continue
        if e is None:
            e = Attempt(id=d.id, user_id=user_id)
            db.add(e)
        e.problem_id = d.problemId
        e.attempts = d.attempts
        e.result = d.result
        e.attempt_date = d.date
        e.updated_at = d.updatedAt
        e.deleted = d.deleted
        e.server_updated_at = seq.next()
    db.flush()

    out_p = db.scalars(select(Problem).where(Problem.user_id == user_id, Problem.server_updated_at > req.since).order_by(Problem.server_updated_at)).all()
    out_a = db.scalars(select(Attempt).where(Attempt.user_id == user_id, Attempt.server_updated_at > req.since).order_by(Attempt.server_updated_at)).all()
    cursor = max([req.since] + [p.server_updated_at for p in out_p] + [a.server_updated_at for a in out_a])
    return SyncResponse(cursor=cursor, problems=[problem_dto(p) for p in out_p], attempts=[attempt_dto(a) for a in out_a])
