import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AuthError, exportFile, fetchOverview, type OverviewData, type OverviewPeriod } from "../api";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const PERIODS: { key: Exclude<OverviewPeriod, "custom">; label: string }[] = [
  { key: "last30", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
  { key: "ytd", label: "Year to date" },
];

const KPI_ORDER: { key: string; label: string; kind: "money" | "count" | "ratio" | "pct" }[] = [
  { key: "spend", label: "Spend", kind: "money" },
  { key: "revenue", label: "Revenue", kind: "money" },
  { key: "conversions", label: "Conversions", kind: "count" },
  { key: "clicks", label: "Clicks", kind: "count" },
  { key: "roas", label: "ROAS", kind: "ratio" },
  { key: "margin_pct", label: "Margin", kind: "pct" },
  { key: "cpm", label: "CPM", kind: "money" },
];

function fmt(value: number | null | undefined, kind: "money" | "count" | "ratio" | "pct"): string {
  if (value === null || value === undefined) return "—";
  if (kind === "money")
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (kind === "pct") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (kind === "ratio") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString();
}

function fmtShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

function fmtDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Recharts passes the series' display name (e.g. "Spend") -- format money for money series,
 *  plain numbers otherwise, and always echo the series' own name back so labels stay correct. */
function tooltipFormatter(value: number, name: string): [string, string] {
  const isMoney = name === "Spend" || name === "Revenue";
  return [isMoney ? fmt(value, "money") : value.toLocaleString(), name];
}

/** Uses CSS variables so the hover tooltip is readable in both light and dark themes. */
const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-secondary)", fontWeight: 600 },
} as const;

function KpiCards({ data }: { data: OverviewData }) {
  return (
    <div className="kpi-grid">
      {KPI_ORDER.map(({ key, label, kind }) => {
        const kpi = data.kpis[key];
        if (!kpi) return null;
        const delta = kpi.delta_pct;
        const isUp = typeof delta === "number" && delta > 0;
        const isDown = typeof delta === "number" && delta < 0;
        return (
          <div className="score-card" key={key}>
            <div className="score-card-label">{label}</div>
            <div className="score-card-value">{fmt(kpi.current, kind)}</div>
            {typeof delta === "number" && (
              <div className={`score-card-delta ${isUp ? "up" : isDown ? "down" : "flat"}`}>
                {isUp ? "▲" : isDown ? "▼" : "–"} {Math.abs(delta)}%
                <span
                  className="score-card-delta-label"
                  title={`Compared to ${data.previous_period.from} – ${data.previous_period.to}: ${fmt(kpi.previous, kind)}`}
                >
                  {" "}
                  vs previous period
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="overview">
      <div className="kpi-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="score-card skeleton" key={i}>
            <div className="skeleton-line w40" />
            <div className="skeleton-line w70 tall" />
            <div className="skeleton-line w50" />
          </div>
        ))}
      </div>
      <div className="overview-charts">
        <div className="panel skeleton chart-skeleton" />
        <div className="panel skeleton chart-skeleton" />
      </div>
      <div className="panel skeleton table-skeleton" />
    </div>
  );
}

/** Small "insights at a glance" facts computed from data already on screen -- best ROAS
 *  platform, highest-margin campaign, biggest spend day. Pure client-side, no extra calls. */
function Highlights({ data }: { data: OverviewData }) {
  const bestPlatform = [...data.platforms].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const bestCampaign = [...data.campaigns].sort((a, b) => (b.margin_pct ?? -Infinity) - (a.margin_pct ?? -Infinity))[0];
  const biggestDay = [...data.trend].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (!bestPlatform && !bestCampaign && !biggestDay) return null;
  return (
    <div className="highlights">
      {bestPlatform && (
        <div className="highlight">
          <span className="highlight-label">Best ROAS</span>
          <span className="highlight-value">{bestPlatform.platform}</span>
          <span className="highlight-detail">{fmt(bestPlatform.roas, "ratio")}x return</span>
        </div>
      )}
      {bestCampaign && (
        <div className="highlight">
          <span className="highlight-label">Top margin campaign</span>
          <span className="highlight-value">{bestCampaign.campaign}</span>
          <span className="highlight-detail">{fmt(bestCampaign.margin_pct, "pct")} margin</span>
        </div>
      )}
      {biggestDay && (
        <div className="highlight">
          <span className="highlight-label">Biggest spend day</span>
          <span className="highlight-value">{fmtDateLabel(biggestDay.date)}</span>
          <span className="highlight-detail">{fmt(biggestDay.spend, "money")}</span>
        </div>
      )}
    </div>
  );
}

function ExportButtons({ queryId, onAuthError }: { queryId: string; onAuthError: (m: string) => void }) {
  async function handle(format: "csv" | "xlsx") {
    try {
      await exportFile(queryId, format);
    } catch (err: any) {
      if (err instanceof AuthError) onAuthError(err.message);
      else alert(err?.message ?? "Export failed.");
    }
  }
  return (
    <div className="export-buttons panel-export">
      <button type="button" onClick={() => handle("csv")}>CSV</button>
      <button type="button" onClick={() => handle("xlsx")}>Excel</button>
    </div>
  );
}

export default function Overview({ onAuthError }: { onAuthError: (message: string) => void }) {
  const [period, setPeriod] = useState<OverviewPeriod>("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOverview(period, appliedCustom ?? undefined)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err.message ?? String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, appliedCustom, onAuthError]);

  function selectPreset(key: Exclude<OverviewPeriod, "custom">) {
    setAppliedCustom(null);
    setPeriod(key);
  }

  function applyCustomRange(e: React.FormEvent) {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    if (customFrom > customTo) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setPeriod("custom");
    setAppliedCustom({ from: customFrom, to: customTo });
  }

  return (
    <div>
      <div className="overview-toolbar">
        <div className="period-selector">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={period === p.key ? "active" : ""}
              onClick={() => selectPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form className={`custom-range${period === "custom" ? " active" : ""}`} onSubmit={applyCustomRange}>
          <input
            type="date"
            value={customFrom}
            min="2025-01-01"
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label="Custom range start date"
          />
          <span className="custom-range-sep">→</span>
          <input
            type="date"
            value={customTo}
            min="2025-01-01"
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label="Custom range end date"
          />
          <button type="submit" disabled={!customFrom || !customTo}>
            Apply
          </button>
        </form>
        {data && (
          <span className="overview-range">
            {data.period.from} → {data.period.to}
          </span>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <Skeleton />}

      {!loading && data && (
        <div className="overview">
          <KpiCards data={data} />

          <Highlights data={data} />

          <div className="overview-charts">
            <div className="panel">
              <div className="panel-header">
                <h3>Spend and revenue by day</h3>
                <ExportButtons queryId={data.export_ids.trend} onAuthError={onAuthError} />
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDateLabel} minTickGap={28} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShort} width={44} />
                  <Tooltip labelFormatter={(l: string) => fmtDateLabel(l)} formatter={tooltipFormatter} {...TOOLTIP_STYLE} />
                  <Legend />
                  <Line type="monotone" dataKey="spend" name="Spend" stroke={COLORS[0]} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS[2]} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h3>Spend by platform</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.platforms} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="platform" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShort} width={44} />
                  <Tooltip formatter={tooltipFormatter} cursor={{ fill: "var(--surface-muted)" }} {...TOOLTIP_STYLE} />
                  <Legend />
                  <Bar dataKey="spend" name="Spend" fill={COLORS[0]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="revenue" name="Revenue" fill={COLORS[2]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {(data.movers.up.length > 0 || data.movers.down.length > 0) && (
            <div className="overview-charts">
              <div className="panel">
                <h3>Gaining revenue vs previous period</h3>
                <ul className="movers-list">
                  {data.movers.up.map((m) => (
                    <li key={m.campaign}>
                      <span className="mover-name">{m.campaign}</span>
                      <span className="mover-delta pos">
                        +{fmt(m.delta, "money")} <small>({m.delta_pct > 0 ? "+" : ""}{m.delta_pct}%)</small>
                      </span>
                    </li>
                  ))}
                  {data.movers.up.length === 0 && <li className="mover-empty">No campaigns gained this period.</li>}
                </ul>
              </div>
              <div className="panel">
                <h3>Declining revenue vs previous period</h3>
                <ul className="movers-list">
                  {data.movers.down.map((m) => (
                    <li key={m.campaign}>
                      <span className="mover-name">{m.campaign}</span>
                      <span className="mover-delta neg">
                        {fmt(m.delta, "money")} <small>({m.delta_pct}%)</small>
                      </span>
                    </li>
                  ))}
                  {data.movers.down.length === 0 && <li className="mover-empty">No campaigns declined this period.</li>}
                </ul>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-header">
              <h3>Top campaigns by spend</h3>
              <ExportButtons queryId={data.export_ids.campaigns} onAuthError={onAuthError} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th className="num">Spend</th>
                    <th className="num">Revenue</th>
                    <th className="num">Conversions</th>
                    <th className="num">ROAS</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.campaign}>
                      <td>{c.campaign}</td>
                      <td className="num">{fmt(c.spend, "money")}</td>
                      <td className="num">{fmt(c.revenue, "money")}</td>
                      <td className="num">{fmt(c.conversions, "count")}</td>
                      <td className={`num ${typeof c.roas === "number" ? (c.roas >= 1 ? "pos" : "neg") : ""}`}>
                        {fmt(c.roas, "ratio")}
                      </td>
                      <td className={`num ${typeof c.margin_pct === "number" ? (c.margin_pct >= 0 ? "pos" : "neg") : ""}`}>
                        {fmt(c.margin_pct, "pct")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
