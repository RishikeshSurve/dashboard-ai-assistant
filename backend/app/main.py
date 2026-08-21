"""
FastAPI backend for the AI dashboard assistant.

Endpoints
---------
POST /api/query      chat prompt -> QuerySpec -> guarded SQL -> executed against read-only
                      connection -> JSON rows (used to render the dashboard) + query_id
GET  /api/export/{query_id}.csv   re-download the last result set as CSV
GET  /api/export/{query_id}.xlsx  re-download the last result set as Excel
GET  /api/schema      semantic layer description (what the assistant can be asked about)
GET  /health

Results are cached in-memory by query_id purely so export can reuse the exact rows the
dashboard rendered (no need to hit the DB twice or worry about data changing between the
chart render and the export click). Swap for Redis in production (see design doc).
"""
import uuid
from dataclasses import replace
from datetime import date, timedelta

from dotenv import load_dotenv
load_dotenv()
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import auth, db, export, nl_query, semantic_layer, sql_guard

app = FastAPI(title="Scout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your frontend origin(s) in production
    allow_methods=["*"],
    allow_headers=["*"],
)

_RESULT_CACHE: dict[str, list[dict]] = {}


@app.on_event("startup")
def _startup():
    # Soft-fail: local/dev runs without DATABASE_URL should still boot (auth routes just
    # won't work until Postgres is configured), rather than crashing the whole API.
    if not auth.DATABASE_URL:
        print("WARNING: DATABASE_URL not set -- auth is disabled. /api/auth/verify and all "
              "protected routes will fail until a Postgres DATABASE_URL is configured.")
        return
    try:
        auth.ensure_schema()
    except Exception as e:
        print(f"WARNING: auth.ensure_schema() failed ({e}). Auth routes will fail until this "
              "is resolved.")


class AuthRequest(BaseModel):
    code: str


class AuthResponse(BaseModel):
    token: str
    label: str


class QueryRequest(BaseModel):
    prompt: str


class QueryBlock(BaseModel):
    # Each block gets its own query_id/cache entry so CSV/Excel export works per-card even when
    # one prompt produced several blocks.
    query_id: str
    # The sub-prompt this block answers. Equal to the original prompt when it wasn't split;
    # the frontend only shows this as a caption when a prompt produced more than one block.
    prompt: str
    sql: str
    columns: list[str]
    rows: list[dict]
    row_count: int
    # The dimension results are grouped by (e.g. "platform", "date"), or None for a grand
    # total. The frontend uses this to decide: None -> score cards, "date" -> line chart,
    # anything else -> bar chart.
    dimension: str | None = None
    # Present only when the prompt asked for a period/YoY comparison. Maps each metric to
    # {current, previous, delta_pct} (totals) or carries just "_range" (grouped comparisons,
    # where the per-row _prev/_change columns carry the numbers instead).
    comparison: dict | None = None


class QueryResponse(BaseModel):
    # Almost every prompt resolves to exactly one block; a compound prompt ("spend by platform
    # and top campaigns by revenue") resolves to more than one. Callers can always just iterate
    # this list instead of branching on single vs. multi.
    results: list[QueryBlock]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/auth/verify", response_model=AuthResponse)
def verify_access_code(req: AuthRequest):
    row = auth.verify_code(req.code.strip())
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked access code.")
    return AuthResponse(token=auth.create_token(row["label"]), label=row["label"])


@app.get("/api/schema")
def schema(_session: dict = Depends(auth.require_session)):
    return {"description": semantic_layer.schema_description()}


@app.post("/api/query", response_model=QueryResponse)
def run_query(req: QueryRequest, _session: dict = Depends(auth.require_session)):
    specs = nl_query.parse_prompt_multi(req.prompt)
    sub_prompts = nl_query.split_compound_prompt(req.prompt)
    # Best-effort pairing of each spec with the sub-prompt text that produced it, for the
    # frontend caption -- falls back to the full prompt if the two lists don't line up (e.g.
    # the LLM path split differently than the rule-based splitter would have).
    prompts = sub_prompts if len(sub_prompts) == len(specs) else [req.prompt] * len(specs)
    results = [_answer_spec(spec, prompt) for spec, prompt in zip(specs, prompts)]
    return QueryResponse(results=results)


def _answer_spec(spec: nl_query.QuerySpec, prompt: str) -> QueryBlock:
    """Runs one QuerySpec end to end (query + optional comparison) and returns a QueryBlock.
    This is the body of what used to be the whole /api/query handler, factored out so a
    compound prompt can call it once per sub-question."""
    sql, params = nl_query.build_sql(spec)

    try:
        sql_guard.validate(sql)
    except sql_guard.UnsafeSQLError as e:
        raise HTTPException(status_code=400, detail=f"Query rejected by safety guard: {e}")

    conn = db.get_connection()
    try:
        cur = conn.execute(sql, params)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()

    dimension = spec.group_by[0] if spec.group_by else None

    comparison = None
    if spec.compare and not spec.group_by and rows:
        prev_from, prev_to = nl_query.previous_period_range(
            spec.date_from or "", spec.date_to or "", spec.compare
        )
        prev_spec = replace(spec, date_from=prev_from, date_to=prev_to, compare=None)
        prev_sql, prev_params = nl_query.build_sql(prev_spec)
        try:
            sql_guard.validate(prev_sql)
            prev_conn = db.get_connection()
            try:
                prev_cur = prev_conn.execute(prev_sql, prev_params)
                prev_row = dict(zip([d[0] for d in prev_cur.description], prev_cur.fetchone() or ()))
            finally:
                prev_conn.close()
            comparison = {}
            for metric, current_val in rows[0].items():
                prev_val = prev_row.get(metric)
                delta_pct = None
                if prev_val not in (None, 0) and current_val is not None:
                    delta_pct = round((current_val - prev_val) / abs(prev_val) * 100, 1)
                comparison[metric] = {"current": current_val, "previous": prev_val, "delta_pct": delta_pct}
            comparison["_range"] = {"previous_from": prev_from, "previous_to": prev_to, "mode": spec.compare}
        except sql_guard.UnsafeSQLError:
            comparison = None  # comparison is best-effort; don't fail the whole request over it

    # Grouped comparison ("spend by campaign vs previous period", "biggest gainers"): run the
    # same grouped query over the comparison window and attach per-row <metric>_prev and
    # <metric>_change columns, joined on the first group_by dimension. This is the Overview's
    # movers analysis made available to any chat prompt.
    if spec.compare and spec.group_by and rows:
        prev_from, prev_to = nl_query.previous_period_range(
            spec.date_from or "", spec.date_to or "", spec.compare
        )
        prev_spec = replace(spec, date_from=prev_from, date_to=prev_to, compare=None, limit=5000)
        prev_sql, prev_params = nl_query.build_sql(prev_spec)
        try:
            sql_guard.validate(prev_sql)
            prev_conn = db.get_connection()
            try:
                prev_cur = prev_conn.execute(prev_sql, prev_params)
                prev_cols = [d[0] for d in prev_cur.description]
                prev_rows = [dict(zip(prev_cols, r)) for r in prev_cur.fetchall()]
            finally:
                prev_conn.close()

            dim_key = spec.group_by[0]
            prev_map = {r.get(dim_key): r for r in prev_rows}
            metric_cols = [c for c in cols if c not in spec.group_by]
            for row in rows:
                prev_row = prev_map.get(row.get(dim_key)) or {}
                for m in metric_cols:
                    prev_val = prev_row.get(m)
                    cur_val = row.get(m)
                    row[f"{m}_prev"] = prev_val
                    row[f"{m}_change"] = (
                        round(cur_val - prev_val, 2) if cur_val is not None and prev_val is not None else None
                    )
            cols = list(rows[0].keys())
            comparison = {"_range": {"previous_from": prev_from, "previous_to": prev_to, "mode": spec.compare}}
        except sql_guard.UnsafeSQLError:
            pass  # best-effort, same as totals comparison

    # Special "delta:<metric>" sort (biggest gainers/decliners): the change column only exists
    # post-join, so sorting happens here rather than in SQL. Rows without a change value sink
    # to the bottom either way.
    if spec.sort_by and spec.sort_by.startswith("delta:") and rows:
        target = f"{spec.sort_by.split(':', 1)[1]}_change"
        if target in rows[0]:
            rows.sort(
                key=lambda r: (r.get(target) is None, (r.get(target) or 0) * (-1 if spec.sort_desc else 1))
            )

    query_id = str(uuid.uuid4())
    _RESULT_CACHE[query_id] = rows

    return QueryBlock(
        query_id=query_id,
        prompt=prompt,
        sql=sql,
        columns=cols,
        rows=rows,
        row_count=len(rows),
        dimension=dimension,
        comparison=comparison,
    )


def _run_guarded(conn, spec: "nl_query.QuerySpec") -> list[dict]:
    """Builds, validates, and executes one QuerySpec on an existing connection."""
    sql, params = nl_query.build_sql(spec)
    sql_guard.validate(sql)
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.get("/api/overview")
def overview(
    period: str = "last30",
    date_from: str | None = None,
    date_to: str | None = None,
    _session: dict = Depends(auth.require_session),
):
    """Everything the Overview dashboard needs in ONE round trip (one HTTP request, one DB
    connection): KPI totals with previous-period comparison, daily trend, platform breakdown,
    and top campaigns. A single call keeps the dashboard fast -- especially on the free-tier
    host, where each extra request risks paying connection overhead.

    Pass explicit date_from/date_to (YYYY-MM-DD) for a custom range; otherwise `period`
    selects a preset (last30 / this_month / ytd)."""
    today = date.today()
    if date_from and date_to:
        try:
            d_from = date.fromisoformat(date_from)
            d_to = date.fromisoformat(date_to)
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be in YYYY-MM-DD format.")
        if d_from > d_to:
            raise HTTPException(status_code=400, detail="date_from must be on or before date_to.")
        label = "Custom range"
        period = "custom"
    elif period == "this_month":
        d_from, d_to = date(today.year, today.month, 1), today
        label = "This month"
    elif period == "ytd":
        d_from, d_to = date(today.year, 1, 1), today
        label = "Year to date"
    else:
        d_from, d_to = today - timedelta(days=30), today
        label = "Last 30 days"
        period = "last30"
    date_from, date_to = d_from.isoformat(), d_to.isoformat()

    kpi_metrics = ["spend", "revenue", "conversions", "clicks", "roas", "margin_pct", "cpa", "ctr", "cpm"]
    base = nl_query.QuerySpec(metrics=kpi_metrics, group_by=[], date_from=date_from, date_to=date_to)

    prev_from, prev_to = nl_query.previous_period_range(date_from, date_to, "previous_period")

    conn = db.get_connection()
    try:
        totals_rows = _run_guarded(conn, base)
        prev_rows = _run_guarded(conn, replace(base, date_from=prev_from, date_to=prev_to))
        trend = _run_guarded(
            conn,
            replace(base, metrics=["spend", "revenue", "conversions"], group_by=["date"], limit=400),
        )
        platforms = _run_guarded(
            conn,
            replace(base, metrics=["spend", "revenue", "conversions", "roas"], group_by=["platform"], limit=20),
        )
        campaigns = _run_guarded(
            conn,
            replace(base, metrics=["spend", "revenue", "conversions", "roas", "margin_pct"], group_by=["campaign"], limit=100),
        )
        prev_campaigns = _run_guarded(
            conn,
            replace(base, metrics=["spend", "revenue"], group_by=["campaign"], date_from=prev_from, date_to=prev_to, limit=100),
        )
    finally:
        conn.close()

    totals = totals_rows[0] if totals_rows else {}
    prev = prev_rows[0] if prev_rows else {}
    kpis = {}
    for metric in kpi_metrics:
        current_val = totals.get(metric)
        prev_val = prev.get(metric)
        delta_pct = None
        if prev_val not in (None, 0) and current_val is not None:
            delta_pct = round((current_val - prev_val) / abs(prev_val) * 100, 1)
        kpis[metric] = {"current": current_val, "previous": prev_val, "delta_pct": delta_pct}

    campaigns.sort(key=lambda r: r.get("spend") or 0, reverse=True)
    top_campaigns = campaigns[:10]

    # Biggest movers: campaigns whose revenue changed most vs the previous period. Uses
    # absolute revenue delta (not %) so tiny campaigns with noisy percentages don't dominate.
    prev_by_campaign = {r["campaign"]: r for r in prev_campaigns}
    movers = []
    for c in campaigns:
        prev_rev = (prev_by_campaign.get(c["campaign"]) or {}).get("revenue")
        cur_rev = c.get("revenue")
        if prev_rev in (None, 0) or cur_rev is None:
            continue
        delta = round(cur_rev - prev_rev, 2)
        movers.append(
            {
                "campaign": c["campaign"],
                "revenue": cur_rev,
                "previous_revenue": prev_rev,
                "delta": delta,
                "delta_pct": round(delta / abs(prev_rev) * 100, 1),
            }
        )
    movers.sort(key=lambda m: m["delta"], reverse=True)
    top_movers = {
        "up": [m for m in movers if m["delta"] > 0][:3],
        "down": sorted([m for m in movers if m["delta"] < 0], key=lambda m: m["delta"])[:3],
    }

    # Cache the trend and campaign tables under query_ids so the existing CSV/Excel export
    # endpoints can serve them -- lets people download exactly what the dashboard shows.
    trend_export_id = str(uuid.uuid4())
    campaigns_export_id = str(uuid.uuid4())
    _RESULT_CACHE[trend_export_id] = trend
    _RESULT_CACHE[campaigns_export_id] = top_campaigns

    return {
        "period": {"from": date_from, "to": date_to, "label": label, "key": period},
        "previous_period": {"from": prev_from, "to": prev_to},
        "kpis": kpis,
        "trend": trend,
        "platforms": platforms,
        "campaigns": top_campaigns,
        "movers": top_movers,
        "export_ids": {"trend": trend_export_id, "campaigns": campaigns_export_id},
    }


@app.get("/api/export/{query_id}.csv")
def export_csv(query_id: str, _session: dict = Depends(auth.require_session)):
    rows = _RESULT_CACHE.get(query_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Query result not found or expired.")
    data = export.to_csv_bytes(rows)
    return Response(
        content=data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=dashboard_{query_id[:8]}.csv"},
    )


@app.get("/api/export/{query_id}.xlsx")
def export_xlsx(query_id: str, _session: dict = Depends(auth.require_session)):
    rows = _RESULT_CACHE.get(query_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Query result not found or expired.")
    data = export.to_excel_bytes(rows)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=dashboard_{query_id[:8]}.xlsx"},
    )
