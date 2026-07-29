"""
Database layer.

In production this points at your existing analytics warehouse (Postgres/Snowflake/BigQuery)
via DATABASE_URL. For this scaffold we use a local SQLite file seeded with realistic sample
data so the whole pipeline (chat -> NL2SQL -> query -> dashboard -> export) runs end-to-end
with zero external dependencies.

Schema mirrors the real system described by the business:
  - campaigns: one row per campaign, tagged with the platform it runs on
  - adsets: children of campaigns; each adset has a UNIQUE ecd_code. This is the join key
            used to stitch in Salesforce (cpv/revenue) and Adobe (visits) data.
  - platform_metrics: daily performance pulled from Facebook, Google Ads, Reddit, Quora,
            PulsePoint (impressions, clicks, spend, conversions) at the adset grain.
  - salesforce_cpv: daily CPV (cost-per-visit/value) per ecd_code from Salesforce, used to
            derive revenue = conversions * cpv (adjust formula to match your real definition).
  - adobe_visits: daily site visits per ecd_code from Adobe Analytics.

A single SQL VIEW (unified_metrics) joins all of the above on (ecd_code, date) so the
NL2SQL layer only ever needs to reason about one wide, documented table.
"""
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


def _seed(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM campaigns")
    if cur.fetchone()[0] > 0:
        return

    rnd = random.Random(42)
    today = date.today()
    start = today - timedelta(days=45)

    campaign_names = [
        "Summer Sale", "Brand Awareness Q3", "Retargeting Push",
        "New Customer Acquisition", "Holiday Promo", "App Install Drive",
    ]

    campaign_rows, adset_rows, metric_rows, cpv_rows, visit_rows = [], [], [], [], []

    for ci, cname in enumerate(campaign_names, start=1):
        campaign_id = f"CMP-{ci:03d}"
        platform = PLATFORMS[ci % len(PLATFORMS)]
        campaign_rows.append((campaign_id, cname, platform, start.isoformat(), None))

        n_adsets = rnd.randint(2, 4)
        for ai in range(1, n_adsets + 1):
            adset_id = f"{campaign_id}-AS{ai}"
            ecd_code = f"ECD-{ci:03d}-{ai:02d}"
            adset_rows.append((adset_id, campaign_id, f"{cname} - Adset {ai}", ecd_code))

            for d in range(45):
                the_date = (start + timedelta(days=d)).isoformat()
                impressions = rnd.randint(2000, 20000)
                clicks = int(impressions * rnd.uniform(0.01, 0.06))
                spend = round(clicks * rnd.uniform(0.5, 2.5), 2)
                conversions = int(clicks * rnd.uniform(0.02, 0.10))
                metric_rows.append((the_date, adset_id, platform, impressions, clicks, spend, conversions))

                cpv_rows.append((the_date, ecd_code, round(rnd.uniform(3.0, 12.0), 2)))
                visit_rows.append((the_date, ecd_code, int(clicks * rnd.uniform(0.8, 1.3))))

    cur.executemany("INSERT INTO campaigns VALUES (?,?,?,?,?)", campaign_rows)
    cur.executemany("INSERT INTO adsets VALUES (?,?,?,?)", adset_rows)
    cur.executemany(
        "INSERT INTO platform_metrics (metric_date, adset_id, platform, impressions, clicks, spend, conversions) "
        "VALUES (?,?,?,?,?,?,?)",
        metric_rows,
    )
    cur.executemany("INSERT INTO salesforce_cpv (metric_date, ecd_code, cpv) VALUES (?,?,?)", cpv_rows)
    cur.executemany("INSERT INTO adobe_visits (metric_date, ecd_code, visits) VALUES (?,?,?)", visit_rows)
    conn.commit()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    _seed(conn)
    return conn
