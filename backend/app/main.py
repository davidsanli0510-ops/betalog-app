"""BetaLog sync server (FastAPI).

Run locally:   uvicorn app.main:app --host 0.0.0.0 --port 8080
Environment:   DATABASE_URL (default: SQLite file in ./data), JWT_SECRET, CORS_ORIGINS, DATA_DIR
"""
import os
import re
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import sync as syncmod
from .models import Base, User
from .schemas import AuthRequest, AuthResponse, MeResponse, SyncRequest, SyncResponse
from .security import Tokens, check_password, hash_password, load_secret

VERSION = "1.1.0"
USERNAME = re.compile(r"^[a-zA-Z0-9_.-]{3,30}$")


class ApiError(Exception):
    """An error whose message is safe to show to the user (the app displays it as-is)."""

    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def normalize_db_url(url: str) -> str:
    # Neon / Render hand out postgres:// or postgresql:// — SQLAlchemy needs the psycopg driver named
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def create_app(database_url: Optional[str] = None, jwt_secret: Optional[str] = None, data_dir: Optional[str] = None,
               cors_origins: Optional[str] = None, static_dir: Optional[str] = None) -> FastAPI:
    data_dir = data_dir or os.environ.get("DATA_DIR", "./data")
    url = database_url or os.environ.get("DATABASE_URL") or f"sqlite:///{Path(data_dir) / 'betalog.db'}"
    url = normalize_db_url(url)
    if url.startswith("sqlite:///"):
        Path(url[len("sqlite:///"):]).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url, connect_args={"check_same_thread": False})
    else:
        # pool_pre_ping: free Postgres (Neon) suspends when idle and drops connections
        engine = create_engine(url, pool_pre_ping=True, pool_recycle=300)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    with SessionLocal() as s:
        seq = syncmod.Sequence(syncmod.current_max_seq(s))
    tokens = Tokens(load_secret(jwt_secret or os.environ.get("JWT_SECRET"), data_dir))

    app = FastAPI(title="BetaLog", version=VERSION)
    origins = [o.strip() for o in (cors_origins or os.environ.get("CORS_ORIGINS", "*")).split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type"], allow_credentials=False, max_age=3600)

    # ---------- errors: always {"message": "..."} ----------
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return JSONResponse({"message": e.message}, status_code=e.status)

    @app.exception_handler(syncmod.BadRequest)
    async def _bad(_: Request, e: syncmod.BadRequest):
        return JSONResponse({"message": e.message}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, e: RequestValidationError):
        return JSONResponse({"message": "요청 형식이 올바르지 않아요."}, status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        msg = {404: "찾을 수 없는 주소예요.", 405: "지원하지 않는 요청이에요."}.get(e.status_code, str(e.detail))
        return JSONResponse({"message": msg}, status_code=e.status_code)

    # ---------- dependencies ----------
    def db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    def current_user(request: Request) -> int:
        h = request.headers.get("authorization", "")
        uid = tokens.verify(h[7:].strip()) if h.lower().startswith("bearer ") else None
        if uid is None:
            raise ApiError(401, "로그인이 필요해요.")
        return uid

    # ---------- routes ----------
    db_kind = "sqlite" if url.startswith("sqlite") else "postgres"
    if db_kind == "sqlite" and os.environ.get("RENDER"):
        print("WARNING: DATABASE_URL is not set — data is kept on Render's temporary disk and will be lost on restart.", flush=True)

    @app.get("/api/health")
    def health():
        return {"ok": True, "name": "betalog-server", "version": VERSION, "database": db_kind}

    @app.post("/api/auth/signup", status_code=201, response_model=AuthResponse)
    def signup(req: AuthRequest, s: Session = Depends(db)):
        username = (req.username or "").strip()
        password = req.password or ""
        if not USERNAME.match(username):
            raise ApiError(400, "아이디는 영문·숫자·._- 로 3~30자예요.")
        if len(password) < 6 or len(password) > 100:
            raise ApiError(400, "비밀번호는 6자 이상이에요.")
        if s.scalar(select(User).where(User.username_lower == username.lower())):
            raise ApiError(409, "이미 있는 아이디예요. 다른 아이디를 쓰거나 로그인하세요.")
        name = (req.displayName or "").strip() or username
        u = User(username=username, username_lower=username.lower(), password_hash=hash_password(password),
                 display_name=name[:30], created_at=int(time.time() * 1000))
        s.add(u)
        s.commit()
        return AuthResponse(token=tokens.issue(u.id), username=u.username, displayName=u.display_name)

    @app.post("/api/auth/login", response_model=AuthResponse)
    def login(req: AuthRequest, s: Session = Depends(db)):
        u = s.scalar(select(User).where(User.username_lower == (req.username or "").strip().lower()))
        if u is None or not req.password or not check_password(req.password, u.password_hash):
            raise ApiError(401, "아이디나 비밀번호가 맞지 않아요.")
        return AuthResponse(token=tokens.issue(u.id), username=u.username, displayName=u.display_name)

    @app.get("/api/me", response_model=MeResponse)
    def me(uid: int = Depends(current_user), s: Session = Depends(db)):
        u = s.get(User, uid)
        if u is None:
            raise ApiError(401, "로그인이 만료됐어요. 다시 로그인해 주세요.")
        return MeResponse(id=u.id, username=u.username, displayName=u.display_name)

    @app.post("/api/sync", response_model=SyncResponse)
    def do_sync(req: SyncRequest, uid: int = Depends(current_user), s: Session = Depends(db)):
        res = syncmod.sync(s, seq, uid, req)
        s.commit()
        return res

    # Optional: serve the built web app (frontend/dist) so http://<PC>:8080 opens it when running locally
    web = static_dir or os.environ.get("STATIC_DIR") or str(Path(__file__).resolve().parents[2] / "frontend" / "dist")
    if Path(web, "index.html").exists():
        app.mount("/", StaticFiles(directory=web, html=True), name="web")

    return app


app = create_app()
