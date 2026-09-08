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

# ── 기동 시 검증: 안전한 기본값 대신 기동 거부 (C3) ──────────────
TOKEN = os.environ.get("SYNC_TOKEN", "")
if len(TOKEN) < 32:
    sys.exit(
        "FATAL: SYNC_TOKEN 환경변수가 없거나 32자 미만입니다. 기동을 중단합니다. "
        "생성 예: python -c \"import secrets;print(secrets.token_hex(32))\""
    )

# ── CORS 화이트리스트 (C2) ────────────────────────────────────
# ALLOWED_ORIGIN에 프런트엔드 도메인을 콤마로 구분해 지정한다.
# 미지정 시 로컬 개발 주소만 허용 — 와일드카드는 사용하지 않는다.
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "").split(",") if o.strip()]
ALLOWED_ORIGINS = _origins or ["http://localhost:5173"]

DB_PATH = os.environ.get("DB_PATH", "growth.db")
MAX_BYTES = 2_000_000  # 상태 페이로드 상한 (M1)

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
    """타이밍 공격에 안전한 상수 시간 비교 (C3)."""
    if not secrets.compare_digest(token or "", TOKEN):
        raise HTTPException(status_code=401, detail="invalid token")


class StateIn(BaseModel):
    value: str


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
    now = time.time()
    con = db()
    con.execute(
        "INSERT INTO state (id, value, updated_at) VALUES (1, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (body.value, now),
    )
    con.commit()
    con.close()
    return {"ok": True, "updatedAt": now}