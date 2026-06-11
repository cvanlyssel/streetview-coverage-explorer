"""PostGIS connection handling.

DATABASE_URL comes from the environment in production (Render injects it);
backend/.env is the dev fallback. The env var wins so a deployed instance
can never silently read a stale .env.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import psycopg2
import psycopg2.pool
from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent

_pool: psycopg2.pool.SimpleConnectionPool | None = None


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or dotenv_values(BACKEND_DIR / ".env").get(
        "DATABASE_URL"
    )
    if not url:
        raise RuntimeError("DATABASE_URL not set (env var or backend/.env)")
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
