"""
Invite-code access gate.

This is deliberately not a full user-account system: there's one shared secret ("access code")
you hand out to whoever should be able to use the dashboard, rather than individual logins.
What it still gives you: the ability to add/revoke codes without redeploying, a basic log of
when the app was accessed and with which code, and a signed session token so the frontend
doesn't have to re-send the raw code on every request.

Storage is Postgres (set DATABASE_URL) rather than the SQLite file used for the demo campaign
data, because access codes need to persist across backend restarts/redeploys -- the SQLite file
on Render's free tier does not.

Flow
----
1. POST /api/auth/verify with {"code": "..."}. If the code exists in access_codes and isn't
   revoked, a row is written to access_log and a signed JWT is returned.
2. The frontend stores that token and sends it as `Authorization: Bearer <token>` on every
   subsequent request.
3. `require_session` (a FastAPI dependency) validates the token's signature and expiry on
   every protected route. No token, or an expired/invalid one, gets a 401.

To add or revoke a code without touching code, connect to the Postgres database directly and
insert/update a row in access_codes -- see the README for the exact SQL.
"""
import os
import secrets
import time
from datetime import datetime, timezone

import jwt
import psycopg2
import psycopg2.extras
from fastapi import Header, HTTPException

DATABASE_URL = os.environ.get("DATABASE_URL")
AUTH_SECRET_KEY = os.environ.get("AUTH_SECRET_KEY")
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days

if not AUTH_SECRET_KEY:
    # Fine for local dev (a fresh secret each restart just invalidates old sessions). Set a
    # real AUTH_SECRET_KEY env var in production so tokens survive a backend restart.
    AUTH_SECRET_KEY = secrets.token_hex(32)
    print("WARNING: AUTH_SECRET_KEY not set -- using a random one-off key. "
          "Existing session tokens will stop working on every restart until you set it.")


def _get_conn():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set. Auth requires a Postgres database -- see README for "
            "how to provision a free one and point this app at it."
        )
    return psycopg2.connect(DATABASE_URL)


def ensure_schema() -> None:
    """Creates the auth tables if they don't exist yet, and seeds one code if the table is
    empty. Safe to call on every startup."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS access_codes (
                    id SERIAL PRIMARY KEY,
                    code TEXT UNIQUE NOT NULL,
                    label TEXT NOT NULL DEFAULT 'default',
                    revoked BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS access_log (
                    id SERIAL PRIMARY KEY,
                    code_id INTEGER REFERENCES access_codes(id),
                    accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("SELECT COUNT(*) FROM access_codes")
            (count,) = cur.fetchone()
            if count == 0:
                seed_code = os.environ.get("ACCESS_CODE_SEED") or secrets.token_urlsafe(6)
                cur.execute(
                    "INSERT INTO access_codes (code, label) VALUES (%s, %s)",
                    (seed_code, "default"),
                )
                print(f"Seeded a default access code (label='default'): {seed_code}")
        conn.commit()
    finally:
        conn.close()


def verify_code(code: str) -> dict | None:
    """Checks a submitted code against the database. Logs the attempt if valid. Returns the
    code's row (id, label) on success, None if invalid/revoked."""
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, code, label FROM access_codes WHERE code = %s AND revoked = FALSE",
                (code,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute("INSERT INTO access_log (code_id) VALUES (%s)", (row["id"],))
        conn.commit()
        return dict(row)
    finally:
        conn.close()


def create_token(label: str) -> str:
    now = int(time.time())
    payload = {"label": label, "iat": now, "exp": now + TOKEN_TTL_SECONDS}
    return jwt.encode(payload, AUTH_SECRET_KEY, algorithm="HS256")


def require_session(authorization: str = Header(default=None)) -> dict:
    """FastAPI dependency: raises 401 unless a valid, unexpired Bearer token is present."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token. Enter your access code first.")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, AUTH_SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Enter your access code again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token.")
    return payload
