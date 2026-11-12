"""BetaLog sync server (FastAPI).

Run locally:   uvicorn app.main:app --host 0.0.0.0 --port 8080
Environment:   DATABASE_URL (default: SQLite file in ./data), JWT_SECRET, CORS_ORIGINS, DATA_DIR,
               SIGNUP_CODE (when set, sign-up needs this invite code — keeps strangers off a public server)
"""
import hmac
import os
import re
import threading
import time
from collections import defaultdict, deque
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
from .security import DUMMY_HASH, Tokens, check_password, hash_password, load_secret

VERSION = "1.1.0"
USERNAME = re.compile(r"^[a-zA-Z0-9_.-]{3,30}$")
MIN_PASSWORD = 8
MAX_BODY = 5 * 1024 * 1024  # bytes; a full first sync of a big log is well under this


class RateLimit:
    """Counts events per key in a sliding window (in memory: enough for one small server process)."""

    def __init__(self, limit: int, window_s: int):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def _prune(self, q: deque, now: float):
        while q and q[0] <= now - self.window:
            q.popleft()

    def blocked(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits.get(key)
            if q is None:
                return False
            self._prune(q, now)
            return len(q) >= self.limit

    def hit(self, key: str):
        now = time.monotonic()
        with self.lock:
            if len(self.hits) > 50_000:  # don't let random keys eat memory
                self.hits.clear()
            q = self.hits[key]
            self._prune(q, now)
            q.append(now)

    def clear(self, key: str):
        with self.lock:
            self.hits.pop(key, None)


class BodyLimit:
    """Rejects request bodies over MAX_BODY before they are read into memory."""

    def __init__(self, app, limit: int):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        for k, v in scope.get("headers", []):
            if k == b"content-length" and v.isdigit() and int(v) > self.limit:
                return await self._too_big(send)
        seen = 0

        async def capped():
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self.limit:
                    raise _TooBig()
            return msg

        try:
            await self.app(scope, capped, send)
        except _TooBig:
            await self._too_big(send)

    @staticmethod
    async def _too_big(send):
        body = '{"message":"요청이 너무 커요."}'.encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class _TooBig(Exception):
    pass


def client_ip(request: Request) -> str:
    # Render's proxy appends the real address as the last X-Forwarded-For entry; earlier entries can be forged
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "?"


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
               cors_origins: Optional[str] = None, static_dir: Optional[str] = None,
               signup_code: Optional[str] = None) -> FastAPI:
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
    invite = (signup_code if signup_code is not None else os.environ.get("SIGNUP_CODE", "")).strip()
    # brute-force guards: wrong passwords per account, auth requests per address, new accounts per address
    fails_per_user = RateLimit(10, 15 * 60)
    auth_per_ip = RateLimit(30, 15 * 60)
    signups_per_ip = RateLimit(5, 60 * 60)

    app = FastAPI(title="BetaLog", version=VERSION)
    origins = [o.strip() for o in (cors_origins or os.environ.get("CORS_ORIGINS", "*")).split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type"], allow_credentials=False, max_age=3600)
    app.add_middleware(BodyLimit, limit=MAX_BODY)

    @app.middleware("http")
    async def _headers(request: Request, call_next):
        res = await call_next(request)
        res.headers.setdefault("X-Content-Type-Options", "nosniff")
        res.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith("/api/"):
            res.headers.setdefault("Cache-Control", "no-store")
        return res

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
        return {"ok": True, "name": "betalog-server", "version": VERSION, "database": db_kind, "inviteRequired": bool(invite)}

    def too_many():
        return ApiError(429, "시도가 너무 많아요. 잠시 후 다시 해 주세요.")

    @app.post("/api/auth/signup", status_code=201, response_model=AuthResponse)
    def signup(req: AuthRequest, request: Request, s: Session = Depends(db)):
        ip = client_ip(request)
        if auth_per_ip.blocked(ip) or signups_per_ip.blocked(ip):
            raise too_many()
        auth_per_ip.hit(ip)
        if invite and not hmac.compare_digest((req.inviteCode or "").strip().encode(), invite.encode()):
            raise ApiError(403, "초대 코드가 맞지 않아요. 서버를 만든 사람에게 물어보세요.")
        username = (req.username or "").strip()
        password = req.password or ""
        if not USERNAME.match(username):
            raise ApiError(400, "아이디는 영문·숫자·._- 로 3~30자예요.")
        if len(password) < MIN_PASSWORD or len(password) > 100:
            raise ApiError(400, f"비밀번호는 {MIN_PASSWORD}자 이상이에요.")
        if s.scalar(select(User).where(User.username_lower == username.lower())):
            raise ApiError(409, "이미 있는 아이디예요. 다른 아이디를 쓰거나 로그인하세요.")
        name = (req.displayName or "").strip() or username
        u = User(username=username, username_lower=username.lower(), password_hash=hash_password(password),
                 display_name=name[:30], created_at=int(time.time() * 1000))
        s.add(u)
        s.commit()
        signups_per_ip.hit(ip)
        return AuthResponse(token=tokens.issue(u.id), username=u.username, displayName=u.display_name)

    @app.post("/api/auth/login", response_model=AuthResponse)
    def login(req: AuthRequest, request: Request, s: Session = Depends(db)):
        ip, key = client_ip(request), (req.username or "").strip().lower()[:30]
        if auth_per_ip.blocked(ip) or fails_per_user.blocked(key):
            raise too_many()
        auth_per_ip.hit(ip)
        u = s.scalar(select(User).where(User.username_lower == key))
        # check a dummy hash for unknown names too, so response time doesn't reveal which accounts exist
        ok = check_password(req.password or "", u.password_hash if u else DUMMY_HASH) and u is not None and bool(req.password)
        if not ok:
            fails_per_user.hit(key)
            raise ApiError(401, "아이디나 비밀번호가 맞지 않아요.")
        fails_per_user.clear(key)
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
