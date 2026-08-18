"""
Semantic layer: the governed vocabulary the NL2SQL agent is allowed to use.

Rather than letting the LLM invent joins/columns freely against raw tables (which is how you
get "same question, different number" bugs), we expose one wide view (unified_metrics, see
db.py) and a fixed registry of metrics/dimensions. The agent's job is to pick from this list,
not to write arbitrary SQL from scratch. This keeps generated SQL predictable, auditable, and
safe to run read-only against production data.
"""
from datetime import date

from . import db

BASE_TABLE = "unified_metrics"

DIMENSIONS = {
    "date": "metric_date",
    "campaign": "campaign_name",
    "adset": "adset_name",
    "platform": "platform",
    "ecd_code": "ecd_code",
}

# metric_key -> (sql_expression, aggregation, human description)
METRICS = {
    "impressions": ("SUM(impressions)", "sum", "Ad impressions served"),
    "clicks": ("SUM(clicks)", "sum", "Ad clicks"),
    # Money metrics are rounded in SQL, not just at display time: float summation leaks
    # artifacts like 3304.1899999999996, and those raw values would otherwise flow into the
    # API, the CSV/Excel exports people use to verify numbers, and the comparison deltas.
    "spend": ("ROUND(SUM(spend), 2)", "sum", "Media spend in USD"),
    "conversions": ("SUM(conversions)", "sum", "Conversions reported by the ad platform"),
    "ctr": ("ROUND(SUM(clicks) * 1.0 / NULLIF(SUM(impressions), 0), 4)", "ratio", "Click-through rate"),
    "cpv": ("ROUND(AVG(cpv), 2)", "avg", "Cost-per-visit/value from Salesforce"),
    "revenue": ("ROUND(SUM(revenue), 2)", "sum", "conversions * Salesforce CPV, joined on ecd_code"),
    "visits": ("SUM(visits)", "sum", "Site visits from Adobe Analytics, joined on ecd_code"),
    "cpa": ("ROUND(SUM(spend) * 1.0 / NULLIF(SUM(conversions), 0), 2)", "ratio", "Cost per acquisition"),
    "roas": ("ROUND(SUM(revenue) * 1.0 / NULLIF(SUM(spend), 0), 2)", "ratio", "Return on ad spend"),
    "margin_pct": (
        "ROUND((SUM(revenue) - SUM(spend)) * 100.0 / NULLIF(SUM(revenue), 0), 2)",
        "ratio",
        "Profit margin percentage: (revenue - spend) / revenue * 100",
    ),
}

VALID_PLATFORMS = ["Facebook", "Google Ads", "Reddit", "Quora", "PulsePoint"]


def schema_description() -> str:
    """Human/LLM-readable description of what's queryable. Fed into the LLM prompt."""
    dims = ", ".join(DIMENSIONS.keys())
    metrics = "\n".join(f"  - {k}: {v[2]}" for k, v in METRICS.items())
    return (
        f"Table: {BASE_TABLE}\n"
        f"Data available from {db.START_DATE.isoformat()} through today ({date.today().isoformat()}), "
        "and grows by one day automatically as time passes -- always resolve relative dates "
        "(\"this year\", \"last 90 days\", \"year to date\") against today's actual date.\n"
        f"Dimensions you may group/filter by: {dims}\n"
        f"Platforms available: {', '.join(VALID_PLATFORMS)}\n"
        f"Metrics available:\n{metrics}\n"
        "Note: revenue and visits are only non-zero for dates/adsets where Salesforce CPV "
        "and Adobe visit data have been matched via ecd_code."
    )
