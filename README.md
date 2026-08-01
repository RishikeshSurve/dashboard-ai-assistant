# Dashboard AI Assistant — Scaffold

A working starter implementation of the chat-to-dashboard platform described in the
accompanying design document. Ask a question in plain English, get a dashboard back, export
the underlying rows as CSV/Excel to verify.

## What's here

- `backend/` — FastAPI service. NL prompt -> QuerySpec -> whitelisted SQL -> SQLite (swap for
  your Postgres warehouse) -> JSON. Includes the SQL safety guard, the semantic layer (metric
  registry), and CSV/Excel export endpoints. Seeded with realistic sample campaign/adset data,
  including the ecd_code join key used to stitch in mock Salesforce CPV and Adobe visit data.
- `frontend/` — React + TypeScript + Vite chat UI. Renders results as score cards, trend lines,
  or bar charts depending on the query, plus CSV/Excel download buttons and the generated SQL
  for transparency.
- `AI_Dashboard_Assistant_Design.docx` — full architecture and design document.
- `architecture-flow.svg` — diagram of the data connectors and deployment flow, open in any
  browser or image viewer.
- `Sample_Dashboard_Data.xlsx` / `.csv` — the current sample data backing the live demo, for
  verifying numbers shown on the dashboard.

## Run it

Backend:
```
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend (separate terminal):
```
cd frontend
npm install
npm run dev
```
Open the URL Vite prints (usually http://localhost:5173). Try: "show me spend, clicks and
revenue by platform for the last 14 days".

## Swapping in the real system

1. **Database**: replace `backend/app/db.py`'s SQLite connection with your Postgres/warehouse
   connection (ideally a **read-only** role). Recreate `unified_metrics` as a real SQL VIEW
   (or materialized view) joining your Facebook/Google Ads/Reddit/Quora/PulsePoint fact tables
   with Salesforce CPV and Adobe visits on `ecd_code` + date.
2. **NL understanding**: set the `ANTHROPIC_API_KEY` environment variable — `nl_query.py`
   already has an `_llm_parse` path that calls Claude with the semantic layer schema and
   returns a structured QuerySpec. Without the key it falls back to a keyword-based parser
   (demo-only, not for production).
3. **Auth**: the invite-code gate (see "Multi-user access" below) is enough for a pilot with a
   trusted group. For real per-user accounts, roles, and audit trails, swap `auth.py` for
   OIDC/SSO and enforce row-level security (e.g. restrict by business unit) before the query
   executes.
4. **Result cache**: swap the in-memory `_RESULT_CACHE` dict in `main.py` for Redis so export
   works across multiple backend instances.

## Multi-user access (invite codes)

The app now sits behind a simple access-code gate instead of being wide open: anyone you want
to use the dashboard needs one shared code (not a full account) to get in.

- **Backend** (`backend/app/auth.py`): codes live in a Postgres table (`access_codes`), not
  SQLite, because they need to survive backend restarts/redeploys. `POST /api/auth/verify`
  checks a submitted code and returns a signed session token (JWT, 30-day expiry); every other
  route (`/api/query`, `/api/schema`, the export endpoints) requires that token via
  `Authorization: Bearer <token>` and returns 401 without it. `/health` stays public.
- **Frontend**: a full-screen gate (`AccessGate.tsx`) asks for the code before showing the chat
  UI, stores the token in `localStorage`, and attaches it to every request. A 401 anywhere
  (expired/revoked token) drops the user back to the gate automatically. There's a "Log out"
  link in the header.

**Required env vars on the backend** (set these on Render — see below):
- `DATABASE_URL` — a Postgres connection string. Render's free Postgres works.
- `AUTH_SECRET_KEY` — a random secret used to sign session tokens. Without it, a new one is
  generated on every restart, which logs everyone out each time the free-tier service sleeps
  and wakes back up — set a fixed one.
- `ACCESS_CODE_SEED` (optional) — the first access code to hand out. If unset, a random one is
  generated on first startup and printed to the Render logs (check there if you didn't set this).

**Adding or revoking codes later** (no redeploy needed): open the Postgres database (Render
dashboard → your database → "Connect" → psql, or any Postgres client) and run:
```sql
-- add a new code
INSERT INTO access_codes (code, label) VALUES ('some-new-code', 'marketing-team');

-- revoke a code
UPDATE access_codes SET revoked = TRUE WHERE code = 'some-old-code';
```

## Deploying to a public URL (so it's not "run terminals every time")

This gives you one link you can open on any device. Backend goes on Render, frontend goes on
Vercel, both free tier. Do this once — after that, every `git push` auto-redeploys both.

**1. Push this project to GitHub** (one time)
```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/dashboard-ai-assistant.git
git push -u origin main
```
Create the (empty) repo on github.com first if you haven't.

**2. Deploy the backend on Render**
- Sign up at render.com (free, no card needed for the free web service tier).
- New + → Blueprint → connect your GitHub repo. Render will detect `render.yaml` at the repo
  root and configure the service automatically (root dir `backend`, build/start commands).
- It will prompt you for the `ANTHROPIC_API_KEY` env var — paste your key, or leave blank to
  use the keyword-fallback parser.
- Deploy. You'll get a URL like `https://dashboard-ai-assistant-backend.onrender.com`.
- Confirm it works: open `<that-url>/health` in a browser — should show `{"status":"ok"}`.
- Free tier note: the service sleeps after 15 minutes of no traffic and takes ~30-50s to wake
  up on the next request. Fine for a demo link; upgrade the plan later if that's a problem.

**3. Deploy the frontend on Vercel**
- Sign up at vercel.com (GitHub login is easiest).
- New Project → import the same GitHub repo.
- Set **Root Directory** to `frontend` (Vercel auto-detects the Vite framework preset).
- Add an environment variable: `VITE_API_BASE_URL` = the Render URL from step 2
  (e.g. `https://dashboard-ai-assistant-backend.onrender.com`, no trailing slash).
- Deploy. You'll get a URL like `https://dashboard-ai-assistant.vercel.app` — that's your
  universal link. Open it on any device.

**4. Future changes**
Just `git add . && git commit -m "..." && git push`. Both Render and Vercel watch the repo and
redeploy automatically — no need to run anything locally again.

See the design document for the full architecture, data model, and phased rollout plan.
