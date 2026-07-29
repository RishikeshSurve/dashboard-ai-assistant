# Dashboard AI Assistant — Scaffold

A working starter implementation of the chat-to-dashboard platform described in the
accompanying design document. Ask a question in plain English, get a dashboard back, export
the underlying rows as CSV/Excel to verify.

## What's here

- `backend/` — FastAPI service. NL prompt -> QuerySpec -> whitelisted SQL -> SQLite (swap for
  your Postgres warehouse) -> JSON. Includes the SQL safety guard, the semantic layer (metric
  registry), and CSV/Excel export endpoints. Seeded with realistic sample campaign/adset data,
  including the ecd_code join key used to stitch in mock Salesforce CPV and Adobe visit data.
- `frontend/` — React + TypeScript + Vite chat UI. Renders results as a bar chart + table with
  CSV/Excel download buttons, and shows the generated SQL for transparency.

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
3. **Auth**: add an auth dependency to the FastAPI routes (OIDC/SSO) and enforce row-level
   security (e.g. restrict by business unit) before the query executes.
4. **Result cache**: swap the in-memory `_RESULT_CACHE` dict in `main.py` for Redis so export
   works across multiple backend instances.

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
