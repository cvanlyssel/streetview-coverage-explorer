"""PostGIS connection handling. DATABASE_URL comes from backend/.env."""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import psycopg2
import psycopg2.pool
from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent

_pool: psycopg2.pool.SimpleConnectionPool | None = None


def database_url() -> str:
    url = dotenv_values(BACKEND_DIR / ".env").get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set in backend/.env")
    return url


def get_conn() -> Iterator[psycopg2.extensions.connection]:
    """FastAPI dependency yielding a pooled connection."""
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.SimpleConnectionPool(1, 5, database_url())
    conn = _pool.getconn()
    try:
        yield conn
        conn.rollback()  # read-only API; discard any open transaction state
    finally:
        _pool.putconn(conn)
