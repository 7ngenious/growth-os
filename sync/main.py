"""
Growth OS Sync — 1인용 상태 동기화 백엔드
스코프 계약: 엔드포인트 2개, 토큰 1개, 테이블 1개. 이 이상 확장 금지.
"""
import os
import sqlite3
import time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

TOKEN = os.environ.get("SYNC_TOKEN", "change-me")  # 배포 시 반드시 환경변수로 교체
DB_PATH = os.environ.get("DB_PATH", "growth.db")

app = FastAPI(title="Growth OS Sync", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개인용. 배포 후 프런트 도메인으로 좁히면 더 좋다
    allow_methods=["*"],
    allow_headers=["*"],
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
    if token != TOKEN:
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