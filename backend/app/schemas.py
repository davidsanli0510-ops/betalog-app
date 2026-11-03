"""Wire format shared with the React app (frontend/src/data/sync.ts)."""
from typing import Optional

from pydantic import BaseModel, Field


class AuthRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    displayName: Optional[str] = None


class AuthResponse(BaseModel):
    token: str
    username: str
    displayName: str


class MeResponse(BaseModel):
    id: int
    username: str
    displayName: str


class ProblemDto(BaseModel):
    id: str
    gym: str
    grade: int
    sector: Optional[str] = ""
    memo: Optional[str] = ""
    createdAt: int
    updatedAt: int
    deleted: bool = False
    marks: Optional[str] = "[]"
    hasPhoto: bool = False
    videoCount: int = 0


class AttemptDto(BaseModel):
    id: str
    problemId: str
    attempts: int
    result: str
    date: int
    updatedAt: int
    deleted: bool = False


class SyncRequest(BaseModel):
    """Rows the phone changed since its last sync, plus the cursor it got last time."""
    since: int = 0
    problems: list[ProblemDto] = Field(default_factory=list)
    attempts: list[AttemptDto] = Field(default_factory=list)


class SyncResponse(BaseModel):
    """Everything that changed on the server after `since`, and the cursor to send next time."""
    cursor: int
    problems: list[ProblemDto]
    attempts: list[AttemptDto]
