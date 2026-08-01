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

from dotenv import load_dotenv
load_dotenv()
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import auth, db, export, nl_query, semantic_layer, sql_guard

app = FastAPI(title="Dashboard AI Assistant API")

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


class QueryResponse(BaseModel):
    query_id: str
    sql: str
    columns: list[str]
    rows: list[dict]
    row_count: int
    # The single dimension results are grouped by (e.g. "platform", "date"), or None for a grand
    # total. The frontend uses this to decide: None -> score cards, "date" -> line chart,
    # anything else -> bar chart.
    dimension: str | None = None
    # Present only when the prompt asked for a period/YoY comparison on a totals (no group_by)
    # query. Maps each metric to {current, previous, delta_pct}.
    comparison: dict | None = None


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
    spec = nl_query.parse_prompt(req.prompt)
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

    query_id = str(uuid.uuid4())
    _RESULT_CACHE[query_id] = rows

    return QueryResponse(
        query_id=query_id,
        sql=sql,
        columns=cols,
        rows=rows,
        row_count=len(rows),
        dimension=dimension,
        comparison=comparison,
    )


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
