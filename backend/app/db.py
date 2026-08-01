"""
Database layer.

In production this points at your existing analytics warehouse (Postgres/Snowflake/BigQuery)
via DATABASE_URL. For this scaffold we use a local SQLite file seeded with realistic sample
data so the whole pipeline (chat -> NL2SQL -> query -> dashboard -> export) runs end-to-end
with zero external dependencies.

Schema mirrors the real system described by the business:
  - campaigns: one row per campaign, tagged with the platform it runs on
  - adsets: children of campaigns; each adset has a UNIQUE ecd_code. This is the join key
            used to stitch in mock Salesforce (cpv/revenue) and Adobe (visits) data.
  - platform_metrics: daily performance pulled from Facebook, Google Ads, Reddit, Quora,
            PulsePoint (impressions, clicks, spend, conversions) at the adset grain.
  - salesforce_cpv: daily CPV (cost-per-visit/value) per ecd_code from Salesforce, used to
            derive revenue = conversions * cpv (adjust formula to match your real definition).
  - adobe_visits: daily site visits per ecd_code from Adobe Analytics.

A single SQL VIEW (unified_metrics) joins all of the above on (ecd_code, date) so the
NL2SQL layer only ever needs to reason about one wide, documented table.

Data coverage
-------------
The mock dataset starts at START_DATE (2025-01-01) and always extends through "today". Every
call to get_connection() runs a cheap top-up check (MAX(metric_date) vs today) and, if there's
a gap, generates the missing days before returning the connection. In practice this means: the
demo dataset keeps growing on its own as real time passes -- no cron job, no manual reseed. Each
(ecd_code, date) pair's numbers are derived from a seeded RNG keyed on that pair, so re-running
this (e.g. after a redeploy wipes the ephemeral SQLite file) regenerates identical historical
values rather than random noise every time.
"""
import hashlib
import os
import random
import sqlite3
import tempfile
from datetime import date, timedelta
from pathlib import Path

# Default DB file lives outside the source tree (e.g. in the OS temp dir) so the scaffold
# works even when the project folder is on a synced/mounted drive that doesn't support
# SQLite's file locking. Override with DASHBOARD_DB_PATH, or point DATABASE_URL at your real
# Postgres warehouse in production (see design doc for the swap).
DB_PATH = os.environ.get(
    "DASHBOARD_DB_PATH", str(Path(tempfile.gettempdir()) / "dashboard_ai_assistant.db")
)

# Fixed start of the mock dataset. The end is always "today" -- see _top_up().
START_DATE = date(2025, 1, 1)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id     TEXT PRIMARY KEY,
    campaign_name   TEXT NOT NULL,
    platform        TEXT NOT NULL,
    start_date      TEXT NOT NULL,
    end_date        TEXT
);

CREATE TABLE IF NOT EXISTS adsets (
    adset_id        TEXT PRIMARY KEY,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(campaign_id),
    adset_name      TEXT NOT NULL,
    ecd_code        TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS platform_metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_date     TEXT NOT NULL,
    adset_id        TEXT NOT NULL REFERENCES adsets(adset_id),
    platform        TEXT NOT NULL,
    impressions     INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    spend           REAL NOT NULL DEFAULT 0,
    conversions     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS salesforce_cpv (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_date     TEXT NOT NULL,
    ecd_code        TEXT NOT NULL,
    cpv             REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS adobe_visits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_date     TEXT NOT NULL,
    ecd_code        TEXT NOT NULL,
    visits          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_metrics_date ON platform_metrics(metric_date);
CREATE INDEX IF NOT EXISTS idx_salesforce_cpv_date_ecd ON salesforce_cpv(metric_date, ecd_code);
CREATE INDEX IF NOT EXISTS idx_adobe_visits_date_ecd ON adobe_visits(metric_date, ecd_code);

DROP VIEW IF EXISTS unified_metrics;
CREATE VIEW unified_metrics AS
SELECT
    pm.metric_date                                   AS metric_date,
    c.campaign_id                                    AS campaign_id,
    c.campaign_name                                  AS campaign_name,
    a.adset_id                                        AS adset_id,
    a.adset_name                                      AS adset_name,
    a.ecd_code                                         AS ecd_code,
    pm.platform                                        AS platform,
    pm.impressions                                     AS impressions,
    pm.clicks                                          AS clicks,
    pm.spend                                           AS spend,
    pm.conversions                                     AS conversions,
    sf.cpv                                             AS cpv,
    ROUND(pm.conversions * COALESCE(sf.cpv, 0), 2)     AS revenue,
    COALESCE(av.visits, 0)                             AS visits
FROM platform_metrics pm
JOIN adsets a      ON a.adset_id = pm.adset_id
JOIN campaigns c   ON c.campaign_id = a.campaign_id
LEFT JOIN salesforce_cpv sf ON sf.ecd_code = a.ecd_code AND sf.metric_date = pm.metric_date
LEFT JOIN adobe_visits av   ON av.ecd_code = a.ecd_code AND av.metric_date = pm.metric_date;
"""

PLATFORMS = ["Facebook", "Google Ads", "Reddit", "Quora", "PulsePoint"]

CAMPAIGN_NAMES = [
    "Summer Sale", "Brand Awareness Q3", "Retargeting Push",
    "New Customer Acquisition", "Holiday Promo", "App Install Drive",
]


def _rnd_for(key: str) -> random.Random:
    """Deterministic RNG seeded from a string key, so a given (ecd_code, date) always produces
    the same numbers no matter when/how many times this runs -- top-ups and full reseeds after
    a redeploy stay consistent instead of regenerating random noise for dates seen before."""
    seed = int(hashlib.sha256(key.encode()).hexdigest(), 16) % (2**32)
    return random.Random(seed)


def _seed_structure(conn: sqlite3.Connection) -> None:
    """Creates the fixed campaign/adset structure once. Safe to call every time -- no-ops if
    campaigns already exist."""
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM campaigns")
    if cur.fetchone()[0] > 0:
        return

    rnd = random.Random(42)
    campaign_rows, adset_rows = [], []

    for ci, cname in enumerate(CAMPAIGN_NAMES, start=1):
        campaign_id = f"CMP-{ci:03d}"
        platform = PLATFORMS[ci % len(PLATFORMS)]
        campaign_rows.append((campaign_id, cname, platform, START_DATE.isoformat(), None))

        n_adsets = rnd.randint(2, 4)
        for ai in range(1, n_adsets + 1):
            adset_id = f"{campaign_id}-AS{ai}"
            ecd_code = f"ECD-{ci:03d}-{ai:02d}"
            adset_rows.append((adset_id, campaign_id, f"{cname} - Adset {ai}", ecd_code))

    cur.executemany("INSERT INTO campaigns VALUES (?,?,?,?,?)", campaign_rows)
    cur.executemany("INSERT INTO adsets VALUES (?,?,?,?)", adset_rows)
    conn.commit()


def _generate_daily_rows(conn: sqlite3.Connection, date_from: date, date_to: date) -> None:
    """Generates platform_metrics/salesforce_cpv/adobe_visits rows for every adset for each
    date in [date_from, date_to] inclusive."""
    if date_from > date_to:
        return

    cur = conn.cursor()
    cur.execute("""
        SELECT a.adset_id, a.ecd_code, c.platform
        FROM adsets a JOIN campaigns c ON c.campaign_id = a.campaign_id
    """)
    adsets = cur.fetchall()

    metric_rows, cpv_rows, visit_rows = [], [], []
    d = date_from
    while d <= date_to:
        the_date = d.isoformat()
        for adset_id, ecd_code, platform in adsets:
            rnd = _rnd_for(f"{ecd_code}|{the_date}")
            impressions = rnd.randint(2000, 20000)
            clicks = int(impressions * rnd.uniform(0.01, 0.06))
            spend = round(clicks * rnd.uniform(0.5, 2.5), 2)
            conversions = int(clicks * rnd.uniform(0.02, 0.10))
            metric_rows.append((the_date, adset_id, platform, impressions, clicks, spend, conversions))
            cpv_rows.append((the_date, ecd_code, round(rnd.uniform(3.0, 12.0), 2)))
            visit_rows.append((the_date, ecd_code, int(clicks * rnd.uniform(0.8, 1.3))))
        d += timedelta(days=1)

    cur.executemany(
        "INSERT INTO platform_metrics (metric_date, adset_id, platform, impressions, clicks, spend, conversions) "
        "VALUES (?,?,?,?,?,?,?)",
        metric_rows,
    )
    cur.executemany("INSERT INTO salesforce_cpv (metric_date, ecd_code, cpv) VALUES (?,?,?)", cpv_rows)
    cur.executemany("INSERT INTO adobe_visits (metric_date, ecd_code, visits) VALUES (?,?,?)", visit_rows)
    conn.commit()


def _top_up(conn: sqlite3.Connection) -> None:
    """Ensures daily rows exist for every day from START_DATE through today. Cheap no-op when
    already current; only does work on the first connection of a new calendar day (or a fresh
    / freshly-wiped database).

    Checks both ends of the existing range, not just the newest date: if START_DATE is ever
    moved earlier (as happened when the dataset was widened to cover all of 2025), a database
    that was already seeded under the old START_DATE would otherwise keep extending forward
    forever without ever backfilling the newly-added earlier history -- silently leaving
    year-over-year / older-date comparisons with no data to compare against.
    """
    cur = conn.cursor()
    cur.execute("SELECT MIN(metric_date), MAX(metric_date) FROM platform_metrics")
    row = cur.fetchone()
    min_date_str, max_date_str = (row[0], row[1]) if row else (None, None)
    today = date.today()

    if max_date_str is None:
        _generate_daily_rows(conn, START_DATE, today)
        return

    min_date = date.fromisoformat(min_date_str)
    max_date = date.fromisoformat(max_date_str)

    if min_date > START_DATE:
        _generate_daily_rows(conn, START_DATE, min_date - timedelta(days=1))

    if max_date < today:
        _generate_daily_rows(conn, max_date + timedelta(days=1), today)


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    _seed_structure(conn)
    _top_up(conn)
    return conn
