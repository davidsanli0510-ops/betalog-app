import os
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


PG = os.environ.get("TEST_DATABASE_URL")  # CI runs the same tests on PostgreSQL too


def db_url(tmp_path, name="test.db"):
    return PG or f"sqlite:///{tmp_path / name}"


@pytest.fixture()
def client(tmp_path):
    app = create_app(database_url=db_url(tmp_path), jwt_secret="test-secret-" + "x" * 32, data_dir=str(tmp_path))
    return TestClient(app)


def name():
    return "u" + uuid.uuid4().hex[:8]


def signup(c, username):
    r = c.post("/api/auth/signup", json={"username": username, "password": "secret123", "displayName": "클라이머"})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def sync(c, token, since, problems=(), attempts=()):
    r = c.post("/api/sync", headers={"Authorization": f"Bearer {token}"}, json={"since": since, "problems": list(problems), "attempts": list(attempts)})
    assert r.status_code == 200, r.text
    return r.json()


def problem(pid, grade=4, memo="", updated=5000, deleted=False):
    return {"id": pid, "gym": "yj", "grade": grade, "sector": "슬랩", "memo": memo, "createdAt": 1000, "updatedAt": updated,
            "deleted": deleted, "marks": '[{"x":10,"y":20}]', "hasPhoto": True, "videoCount": 2}


def attempt(aid, pid, result="SEND", updated=5000):
    return {"id": aid, "problemId": pid, "attempts": 3, "result": result, "date": 2000, "updatedAt": updated, "deleted": False}


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_signup_login_me(client):
    n = name()
    token = signup(client, n)
    dup = client.post("/api/auth/signup", json={"username": n.upper(), "password": "secret123"})
    assert dup.status_code == 409 and "이미 있는 아이디" in dup.json()["message"]
    bad = client.post("/api/auth/login", json={"username": n, "password": "wrong-pass"})
    assert bad.status_code == 401 and bad.json()["message"] == "아이디나 비밀번호가 맞지 않아요."
    ok = client.post("/api/auth/login", json={"username": n, "password": "secret123"})
    assert ok.status_code == 200 and ok.json()["displayName"] == "클라이머" and ok.json()["token"]
    me = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["username"] == n


def test_rejects_bad_signup(client):
    assert client.post("/api/auth/signup", json={"username": "a!", "password": "secret123"}).status_code == 400
    assert client.post("/api/auth/signup", json={"username": name(), "password": "123"}).status_code == 400


def test_sync_needs_login(client):
    r = client.post("/api/sync", json={"since": 0})
    assert r.status_code == 401 and r.json()["message"] == "로그인이 필요해요."
    assert client.post("/api/sync", headers={"Authorization": "Bearer nope"}, json={"since": 0}).status_code == 401


def test_push_then_pull_on_another_phone(client):
    token = signup(client, name())
    pid, aid = str(uuid.uuid4()), str(uuid.uuid4())
    r1 = sync(client, token, 0, [problem(pid, memo="왼발 하이스텝")], [attempt(aid, pid)])
    assert r1["cursor"] > 0
    r2 = sync(client, token, 0)  # a second phone with an empty cursor gets everything
    assert len(r2["problems"]) == 1 and r2["problems"][0]["memo"] == "왼발 하이스텝"
    assert '"x":10' in r2["problems"][0]["marks"]
    assert r2["attempts"][0]["result"] == "SEND"
    r3 = sync(client, token, r2["cursor"])
    assert r3["problems"] == [] and r3["attempts"] == [] and r3["cursor"] == r2["cursor"]


def test_newest_edit_wins_and_deletes_propagate(client):
    token = signup(client, name())
    pid = str(uuid.uuid4())
    c1 = sync(client, token, 0, [problem(pid, memo="first", updated=5000)])["cursor"]
    sync(client, token, c1, [problem(pid, grade=2, memo="stale", updated=4000)])  # older edit from an offline phone
    allp = sync(client, token, 0)
    assert allp["problems"][0]["memo"] == "first" and allp["problems"][0]["grade"] == 4
    c2 = allp["cursor"]
    sync(client, token, c2, [problem(pid, memo="first", updated=9000, deleted=True)])
    after = sync(client, token, c2)
    assert len(after["problems"]) == 1 and after["problems"][0]["deleted"] is True


def test_cannot_touch_another_users_rows(client):
    alice, bob = signup(client, name()), signup(client, name())
    pid = str(uuid.uuid4())
    sync(client, alice, 0, [problem(pid, memo="alice")])
    b = sync(client, bob, 0, [problem(pid, grade=1, memo="bob", updated=99999)], [attempt(str(uuid.uuid4()), pid, "FLASH", 99999)])
    assert b["problems"] == [] and b["attempts"] == []
    a = sync(client, alice, 0)
    assert a["problems"][0]["memo"] == "alice" and a["attempts"] == []


def test_rejects_invalid_rows(client):
    token = signup(client, name())
    r = client.post("/api/sync", headers={"Authorization": f"Bearer {token}"},
                    json={"since": 0, "problems": [], "attempts": [attempt(str(uuid.uuid4()), "p", "WINNING", 1)]})
    assert r.status_code == 400 and r.json()["message"] == "결과 값이 올바르지 않아요."
    r = client.post("/api/sync", headers={"Authorization": f"Bearer {token}"}, json={"since": "not-a-number"})
    assert r.status_code == 400 and r.json()["message"] == "요청 형식이 올바르지 않아요."


def test_cors_allows_the_android_app(client):
    r = client.options("/api/sync", headers={"Origin": "https://localhost", "Access-Control-Request-Method": "POST",
                                             "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200 and r.headers.get("access-control-allow-origin")


def test_data_survives_restart(tmp_path):
    url, secret = db_url(tmp_path, "keep.db"), "s" * 40
    c1 = TestClient(create_app(database_url=url, jwt_secret=secret, data_dir=str(tmp_path)))
    token = signup(c1, name())
    cur = sync(c1, token, 0, [problem(str(uuid.uuid4()), memo="남아 있어야 함")])["cursor"]
    c2 = TestClient(create_app(database_url=url, jwt_secret=secret, data_dir=str(tmp_path)))
    r = sync(c2, token, 0)  # same token still valid, data still there
    assert r["problems"][0]["memo"] == "남아 있어야 함"
    # the change counter keeps growing after a restart
    pid2 = str(uuid.uuid4())
    r2 = sync(c2, token, cur, [problem(pid2, memo="new")])
    assert [p["id"] for p in r2["problems"]] == [pid2] and r2["cursor"] > cur


# ---------- security ----------
def test_password_needs_8_chars(client):
    r = client.post("/api/auth/signup", json={"username": name(), "password": "short12"})
    assert r.status_code == 400 and "8자" in r.json()["message"]


def test_login_brute_force_is_slowed(client):
    n = name()
    signup(client, n)
    for _ in range(10):
        assert client.post("/api/auth/login", json={"username": n, "password": "wrong-pass"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": n, "password": "secret123"})
    assert r.status_code == 429  # locked for a while, even with the right password
    # other accounts are not affected
    m = name()
    signup(client, m)
    assert client.post("/api/auth/login", json={"username": m, "password": "secret123"}).status_code == 200


def test_signups_per_address_are_limited(client):
    codes = [client.post("/api/auth/signup", json={"username": name(), "password": "secret123"}).status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


def test_invite_code(tmp_path):
    c = TestClient(create_app(database_url=db_url(tmp_path), jwt_secret="t" * 40, data_dir=str(tmp_path), signup_code="climb2026"))
    assert c.get("/api/health").json()["inviteRequired"] is True
    body = {"username": name(), "password": "secret123"}
    assert c.post("/api/auth/signup", json=body).status_code == 403
    assert c.post("/api/auth/signup", json={**body, "inviteCode": "nope"}).status_code == 403
    assert c.post("/api/auth/signup", json={**body, "inviteCode": "climb2026"}).status_code == 201


def test_huge_body_is_rejected(client):
    t = signup(client, name())
    big = "x" * (6 * 1024 * 1024)
    r = client.post("/api/sync", headers={"Authorization": f"Bearer {t}", "Content-Type": "application/json"},
                    content=('{"since":0,"problems":[],"pad":"' + big + '"}').encode())
    assert r.status_code == 413


def test_forged_token_is_rejected(client):
    import jwt as pyjwt
    t = signup(client, name())
    forged = pyjwt.encode({"sub": "1", "exp": 9999999999}, "guessed-secret-" + "y" * 32, algorithm="HS256")
    none_alg = pyjwt.encode({"sub": "1", "exp": 9999999999}, None, algorithm="none")
    for bad in (forged, none_alg, t[:-3] + "abc"):
        assert client.get("/api/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["cache-control"] == "no-store"


def test_rows_per_account_are_capped(client, monkeypatch):
    from app import sync as syncmod
    monkeypatch.setattr(syncmod, "MAX_ROWS_PER_USER", 2)
    t = signup(client, name())
    sync(client, t, 0, problems=[problem("cap-a"), problem("cap-b")])
    sync(client, t, 0, problems=[problem("cap-a", memo="edit", updated=6000)])  # editing is still fine
    r = client.post("/api/sync", headers={"Authorization": f"Bearer {t}"}, json={"since": 0, "problems": [problem("cap-c")], "attempts": []})
    assert r.status_code == 413
