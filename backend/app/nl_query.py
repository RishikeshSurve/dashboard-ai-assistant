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
    # Empty group_by means "grand total, no breakdown" -> rendered as score cards by the frontend.
    group_by: list[str] = field(default_factory=list)
    platforms: list[str] | None = None
    campaign_contains: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    limit: int = 500
    # "previous_period" (immediately preceding range of equal length) or "yoy" (same dates, 1 year back).
    compare: str | None = None


def _default_date_range(days: int = 30) -> tuple[str, str]:
    today = date.today()
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


MONTH_NAMES = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10,
    "nov": 11, "november": 11, "dec": 12, "december": 12,
}
_MONTH_PATTERN = "|".join(sorted(MONTH_NAMES, key=len, reverse=True))


def _month_end(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def _parse_date_range_from_text(text: str) -> tuple[str, str] | None:
    """Recognizes explicit ranges and calendar-period phrases (needed now that the dataset
    spans full years, not just a recent window) -- e.g. "in 2025", "this year", "year to
    date", "Jan 2026", "from 2025-03-01 to 2025-05-31". Returns None if nothing more specific
    than "last N days" (handled by the caller) is present.

    Month+year detection runs before the bare-year fallback below -- otherwise a phrase like
    "Jan 2026" would match the bare "20\\d{2}" pattern and incorrectly return the whole year
    instead of just that month.
    """
    today = date.today()

    m = re.search(r"(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})", text)
    if m:
        return m.group(1), m.group(2)

    # "Jan 2026", "January 2026", "in Jan 2026", "for january 2026"
    m = re.search(rf"\b({_MONTH_PATTERN})\.?\s+(20\d{{2}})\b", text)
    if m:
        month = MONTH_NAMES[m.group(1)]
        year = int(m.group(2))
        start = date(year, month, 1)
        end = min(_month_end(year, month), today)
        return start.isoformat(), max(start, end).isoformat()

    if "year to date" in text or re.search(r"\bytd\b", text):
        return date(today.year, 1, 1).isoformat(), today.isoformat()

    if "this year" in text:
        return date(today.year, 1, 1).isoformat(), today.isoformat()

    if "this month" in text:
        start = date(today.year, today.month, 1)
        return start.isoformat(), today.isoformat()

    if "last month" in text:
        first_of_this_month = date(today.year, today.month, 1)
        last_month_end = first_of_this_month - timedelta(days=1)
        start = date(last_month_end.year, last_month_end.month, 1)
        return start.isoformat(), last_month_end.isoformat()

    is_comparison_mention = "compared" in text or re.search(r"\bvs\b", text)

    if not is_comparison_mention and "last year" in text:
        year = today.year - 1
        return date(year, 1, 1).isoformat(), date(year, 12, 31).isoformat()

    m = re.search(r"\b(?:in|for|during)\s+(20\d{2})\b", text)
    if not m and not is_comparison_mention:
        m = re.search(r"\b(20\d{2})\b", text)
    if m:
        year = int(m.group(1))
        year_end = min(date(year, 12, 31), today)
        return date(year, 1, 1).isoformat(), year_end.isoformat()

    return None


def previous_period_range(date_from: str, date_to: str, mode: str) -> tuple[str, str]:
    """Compute the comparison date range for a given current range + comparison mode."""
    d_from = date.fromisoformat(date_from)
    d_to = date.fromisoformat(date_to)
    if mode == "yoy":
        return (
            date(d_from.year - 1, d_from.month, d_from.day).isoformat(),
            date(d_to.year - 1, d_to.month, d_to.day).isoformat(),
        )

    # If the current range looks like a calendar month -- starts on the 1st and stays within
    # that same month -- "previous period" means the same day-range in the immediately
    # preceding calendar month (e.g. Aug 1-15 vs Jul 1-15), not a strict N-days-before window.
    # This matches how people actually read "previous period" for a month ("compare to last
    # month") and avoids a lopsided 1-day-vs-1-day comparison on the 1st of the month.
    is_month_shaped = d_from.day == 1 and d_to.year == d_from.year and d_to.month == d_from.month
    if is_month_shaped:
        prev_month_last_day = d_from - timedelta(days=1)
        prev_month_first_day = date(prev_month_last_day.year, prev_month_last_day.month, 1)
        day_offset = (d_to - d_from).days
        prev_to = min(prev_month_first_day + timedelta(days=day_offset), prev_month_last_day)
        return prev_month_first_day.isoformat(), prev_to.isoformat()

    # Otherwise: shift the whole window back by its own length, immediately preceding it.
    # This is the standard ad-platform definition of "previous period" for non-month ranges
    # (e.g. "last 30 days") -- compare against the equal-length window right before it.
    span = (d_to - d_from).days + 1
    prev_to = d_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=span - 1)
    return prev_from.isoformat(), prev_to.isoformat()


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
    # No explicit "by X" phrase -> grand total, no breakdown. Frontend renders this as score cards.
    spec.group_by = group_by

    platforms = [p for p in sl.VALID_PLATFORMS if p.lower() in text or p.lower().replace(" ", "") in text]
    if platforms:
        spec.platforms = platforms

    date_range = _parse_date_range_from_text(text)
    if date_range:
        spec.date_from, spec.date_to = date_range
    else:
        m = re.search(r"last (\d+) days?", text)
        days = int(m.group(1)) if m else 30
        spec.date_from, spec.date_to = _default_date_range(days)

    if "year over year" in text or "yoy" in text or "vs last year" in text or "compared to last year" in text:
        spec.compare = "yoy"
    elif (
        "previous period" in text
        or "prior period" in text
        or "vs last period" in text
        or "period over period" in text
        or "pop" in text.split()
        or "week over week" in text
        or "wow" in text.split()
        or "month over month" in text
        or "mom" in text.split()
        or ("compared to" in text and "previous" in text)
    ):
        spec.compare = "previous_period"

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
        "\"date_from\": \"YYYY-MM-DD\", \"date_to\": \"YYYY-MM-DD\", \"limit\": int, "
        "\"compare\": \"previous_period\" | \"yoy\" | null}\n\n"
        "Leave group_by as an empty array [] when the user just wants overall totals with no "
        "breakdown (e.g. \"what's my total spend\") -- this renders as score cards. Only include "
        "a dimension in group_by when the user explicitly asks to break results out by it "
        "(e.g. \"by platform\", \"by campaign\", \"trend\"/\"daily\" implies group_by ['date']). "
        "Set compare to 'previous_period' when the user asks to compare against the prior "
        "period of equal length (e.g. \"vs last period\", \"week over week\"), or 'yoy' when "
        "they ask for a year-over-year comparison. Otherwise leave compare null.\n\n"
        "Be precise about date ranges: a specific month like \"Jan 2026\" or \"January 2026\" "
        "means date_from/date_to spanning ONLY that calendar month (e.g. 2026-01-01 to "
        "2026-01-31), never the whole year. \"in 2026\" or \"this year\" with no month "
        "mentioned means the full calendar year. Don't widen a range beyond what the user "
        "actually asked for."
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
        group_by=data.get("group_by") or [],
        platforms=data.get("platforms"),
        campaign_contains=data.get("campaign_contains"),
        date_from=data.get("date_from") or date_from,
        date_to=data.get("date_to") or date_to,
        limit=int(data.get("limit") or 500),
        compare=data.get("compare"),
    )


def parse_prompt(prompt: str) -> QuerySpec:
    if ANTHROPIC_API_KEY:
        try:
            return _llm_parse(prompt)
        except Exception:
            pass  # fall back rather than hard-fail the request
    return _rule_based_parse(prompt)


def build_sql(spec: QuerySpec) -> tuple[str, list[Any]]:
    """QuerySpec -> parameterized, whitelisted-only SQL. Never string-concatenates user text into SQL.

    An empty group_by means "grand total, no breakdown": the query returns exactly one row with
    just the requested metric aggregates and no dimension columns. The frontend renders this as
    score cards rather than a chart.
    """
    metrics = [m for m in spec.metrics if m in sl.METRICS] or ["spend"]
    group_by = [g for g in spec.group_by if g in sl.DIMENSIONS]

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

    sql = f"SELECT {', '.join(select_cols)} FROM {sl.BASE_TABLE} WHERE {' AND '.join(where_clauses)}"

    if group_by:
        group_cols = ", ".join(sl.DIMENSIONS[g] for g in group_by)
        order_col = sl.DIMENSIONS[group_by[0]]
        sql += f" GROUP BY {group_cols} ORDER BY {order_col}"

    sql += " LIMIT ?"
    params.append(min(spec.limit, 5000) if group_by else 1)
    return sql, params
