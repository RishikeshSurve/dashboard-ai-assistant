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

from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import db, export, nl_query, semantic_layer, sql_guard

app = FastAPI(title="Dashboard AI Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your frontend origin(s) in production
    allow_methods=["*"],
    allow_headers=["*"],
)

_RESULT_CACHE: dict[str, list[dict]] = {}


class QueryRequest(BaseModel):
    prompt: str


class QueryResponse(BaseModel):
    query_id: str
    sql: str
    columns: list[str]
    rows: list[dict]
    row_count: int


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/schema")
def schema():
    return {"description": semantic_layer.schema_description()}


@app.post("/api/query", response_model=QueryResponse)
def run_query(req: QueryRequest):
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

    query_id = str(uuid.uuid4())
    _RESULT_CACHE[query_id] = rows

    return QueryResponse(query_id=query_id, sql=sql, columns=cols, rows=rows, row_count=len(rows))


@app.get("/api/export/{query_id}.csv")
def export_csv(query_id: str):
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
def export_xlsx(query_id: str):
    rows = _RESULT_CACHE.get(query_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Query result not found or expired.")
    data = export.to_excel_bytes(rows)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=dashboard_{query_id[:8]}.xlsx"},
    )
