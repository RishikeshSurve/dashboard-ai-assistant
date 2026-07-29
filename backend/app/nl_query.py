"""
Natural-language -> QuerySpec -> SQL.

Two-stage design (recommended pattern, see design doc "NL2SQL Pipeline"):
  1. LLM reads the user's prompt + the semantic layer schema description and returns a
     small structured JSON "QuerySpec" (metrics, group_by dimensions, filters, date range,
     sort, limit). It does NOT write raw SQL. This is what keeps output constrained and safe.
  2. A deterministic Python function turns QuerySpec -> parameterized SQL using only the
     whitelisted expressions in semantic_layer.py.

If ANTHROPIC_API_KEY is set, step 1 calls Claude with tool-use / structured output.
If not, a rule-based keyword parser stands in so this scaffold runs with zero external
dependencies -- swap _rule_based_parse for the LLM call in production.
"""
import json
import os
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from . import semantic_layer as sl

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")


@dataclass
class QuerySpec:
    metrics: list[str] = field(default_factory=lambda: ["spend", "clicks", "conversions"])
    group_by: list[str] = field(default_factory=lambda: ["date"])
    platforms: list[str] | None = None
    campaign_contains: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    limit: int = 500


def _default_date_range(days: int = 30) -> tuple[str, str]:
    today = date.today()
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


def _rule_based_parse(prompt: str) -> QuerySpec:
    """Lightweight fallback NL parser (keyword matching) used when no LLM key is configured."""
    text = prompt.lower()
    spec = QuerySpec()

    found_metrics = [m for m in sl.METRICS if m in text or m.rstrip("s") in text]
    if "revenue" in text:
        found_metrics.append("revenue")
    if "visit" in text:
        found_metrics.append("visits")
    if "cpv" in text:
        found_metrics.append("cpv")
    if "roas" in text or "return on ad spend" in text:
        found_metrics.append("roas")
    if "margin" in text:
        found_metrics.append("margin_pct")
    if found_metrics:
        spec.metrics = sorted(set(found_metrics), key=list(sl.METRICS.keys()).index)

    group_by = []
    if "by platform" in text or "per platform" in text or "each platform" in text:
        group_by.append("platform")
    if "by campaign" in text or "per campaign" in text or "each campaign" in text:
        group_by.append("campaign")
    if "by adset" in text or "ad set" in text and "by" in text:
        group_by.append("adset")
    if "by day" in text or "daily" in text or "trend" in text or "over time" in text:
        group_by.append("date")
    spec.group_by = group_by or ["platform"]

    platforms = [p for p in sl.VALID_PLATFORMS if p.lower() in text or p.lower().replace(" ", "") in text]
    if platforms:
        spec.platforms = platforms

    m = re.search(r"last (\d+) days?", text)
    days = int(m.group(1)) if m else 30
    spec.date_from, spec.date_to = _default_date_range(days)

    m = re.search(r"campaign[s]? (?:called|named|containing|with name)?\s*[\"']?([a-z0-9 ]+)[\"']?", text)
    if m:
        candidate = m.group(1).strip()
        if candidate and candidate not in ("s", ""):
            spec.campaign_contains = candidate

    return spec


def _llm_parse(prompt: str) -> QuerySpec:
    """Production path: ask Claude to return a QuerySpec as JSON, constrained to the semantic layer."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    system = (
        "You translate a marketing analyst's request into a JSON QuerySpec for a fixed "
        "semantic layer. Only use fields/values defined below. Respond with JSON only.\n\n"
        f"{sl.schema_description()}\n\n"
        "QuerySpec JSON shape: {\"metrics\": [...], \"group_by\": [...], "
        "\"platforms\": [...] | null, \"campaign_contains\": str | null, "
        "\"date_from\": \"YYYY-MM-DD\", \"date_to\": \"YYYY-MM-DD\", \"limit\": int}"
    )
    resp = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=500,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = resp.content[0].text
    data: dict[str, Any] = json.loads(raw)
    date_from, date_to = _default_date_range(30)
    return QuerySpec(
        metrics=data.get("metrics") or ["spend", "clicks", "conversions"],
        group_by=data.get("group_by") or ["platform"],
        platforms=data.get("platforms"),
        campaign_contains=data.get("campaign_contains"),
        date_from=data.get("date_from") or date_from,
        date_to=data.get("date_to") or date_to,
        limit=int(data.get("limit") or 500),
    )


def parse_prompt(prompt: str) -> QuerySpec:
    if ANTHROPIC_API_KEY:
        try:
            return _llm_parse(prompt)
        except Exception:
            pass  # fall back rather than hard-fail the request
    return _rule_based_parse(prompt)


def build_sql(spec: QuerySpec) -> tuple[str, list[Any]]:
    """QuerySpec -> parameterized, whitelisted-only SQL. Never string-concatenates user text into SQL."""
    metrics = [m for m in spec.metrics if m in sl.METRICS] or ["spend"]
    group_by = [g for g in spec.group_by if g in sl.DIMENSIONS] or ["platform"]

    select_cols = [f"{sl.DIMENSIONS[g]} AS {g}" for g in group_by]
    select_cols += [f"{sl.METRICS[m][0]} AS {m}" for m in metrics]

    where_clauses = ["metric_date BETWEEN ? AND ?"]
    params: list[Any] = [spec.date_from or _default_date_range()[0], spec.date_to or _default_date_range()[1]]

    if spec.platforms:
        placeholders = ",".join("?" for _ in spec.platforms)
        where_clauses.append(f"platform IN ({placeholders})")
        params.extend(spec.platforms)

    if spec.campaign_contains:
        where_clauses.append("LOWER(campaign_name) LIKE ?")
        params.append(f"%{spec.campaign_contains.lower()}%")

    group_cols = ", ".join(sl.DIMENSIONS[g] for g in group_by)
    order_col = sl.DIMENSIONS[group_by[0]]

    sql = (
        f"SELECT {', '.join(select_cols)} "
        f"FROM {sl.BASE_TABLE} "
        f"WHERE {' AND '.join(where_clauses)} "
        f"GROUP BY {group_cols} "
        f"ORDER BY {order_col} "
        f"LIMIT ?"
    )
    params.append(min(spec.limit, 5000))
    return sql, params
