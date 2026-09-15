"""
Growth OS Sync — 1인용 상태 동기화 백엔드
스코프 계약: 엔드포인트 2개, 토큰 1개, 테이블 1개. 이 이상 확장 금지.
위협 모델과 수용된 위험은 SECURITY.md 참조.
"""
import os
import secrets
import sqlite3
import sys
import time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 기동 시 검증: 안전한 기본값 대신 기동 거부 ──────────────────
TOKEN = os.environ.get("SYNC_TOKEN", "")
if len(TOKEN) < 32:
    sys.exit(
        "FATAL: SYNC_TOKEN 환경변수가 없거나 32자 미만입니다. 기동을 중단합니다. "
        "생성 예: python -c \"import secrets;print(secrets.token_hex(32))\""
    )

# ── CORS 화이트리스트 ─────────────────────────────────────────
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "").split(",") if o.strip()]
ALLOWED_ORIGINS = _origins or ["http://localhost:5173"]

DB_PATH = os.environ.get("DB_PATH", "growth.db")
MAX_BYTES = 2_000_000

app = FastAPI(title="Growth OS Sync", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "PUT"],
    allow_headers=["Content-Type", "X-Sync-Token"],
)


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "CREATE TABLE IF NOT EXISTS state ("
        "  id INTEGER PRIMARY KEY CHECK (id = 1),"
        "  value TEXT NOT NULL,"
        "  updated_at REAL NOT NULL)"
    )
    return con


def check(token: str) -> None:
    if not secrets.compare_digest(token or "", TOKEN):
        raise HTTPException(status_code=401, detail="invalid token")


class StateIn(BaseModel):
    value: str
    # 클라이언트가 마지막으로 확인한 서버 갱신 시각.
    # 서버가 그보다 더 최근이면 덮어쓰기를 거부한다(낙관적 동시성 제어).
    # None이면 검사를 건너뛴다 — 최초 저장 및 복구용.
    baseUpdatedAt: float | None = None


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/state")
def get_state(x_sync_token: str = Header(default="")):
    check(x_sync_token)
    con = db()
    row = con.execute("SELECT value, updated_at FROM state WHERE id = 1").fetchone()
    con.close()
    if row is None:
        return {"value": None, "updatedAt": None}
    return {"value": row[0], "updatedAt": row[1]}


@app.put("/state")
def put_state(body: StateIn, x_sync_token: str = Header(default="")):
    check(x_sync_token)
    if len(body.value.encode("utf-8")) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")

    con = db()
    row = con.execute("SELECT updated_at FROM state WHERE id = 1").fetchone()
    current = row[0] if row else None

    # 낡은 클라이언트가 최신 기록을 덮어쓰는 것을 서버가 거부한다.
    # 0.5초 여유는 부동소수 오차와 왕복 지연을 흡수하기 위함.
    if current is not None and body.baseUpdatedAt is not None:
        if current > body.baseUpdatedAt + 0.5:
            stale = con.execute("SELECT value, updated_at FROM state WHERE id = 1").fetchone()
            con.close()
            raise HTTPException(
                status_code=409,
                detail={"reason": "stale write rejected",
                        "serverUpdatedAt": stale[1]},
            )

    now = time.time()
    con.execute(
        "INSERT INTO state (id, value, updated_at) VALUES (1, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (body.value, now),
    )
    con.commit()
    con.close()
    return {"ok": True, "updatedAt": now}