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
import { AuthError, fetchOverview, type OverviewData, type OverviewPeriod } from "../api";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const PERIODS: { key: OverviewPeriod; label: string }[] = [
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

export default function Overview({ onAuthError }: { onAuthError: (message: string) => void }) {
  const [period, setPeriod] = useState<OverviewPeriod>("last30");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOverview(period)
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
  }, [period, onAuthError]);

  return (
    <div>
      <div className="overview-toolbar">
        <div className="period-selector">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={period === p.key ? "active" : ""}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
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

          <div className="overview-charts">
            <div className="panel">
              <h3>Spend and revenue by day</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDateLabel} minTickGap={28} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShort} width={44} />
                  <Tooltip
                    labelFormatter={(l: string) => fmtDateLabel(l)}
                    formatter={(value: number, name: string) =>
                      name === "conversions" ? [value.toLocaleString(), "Conversions"] : [fmt(value, "money"), name === "spend" ? "Spend" : "Revenue"]
                    }
                  />
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
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === "conversions" ? [value.toLocaleString(), "Conversions"] : [fmt(value, "money"), name === "spend" ? "Spend" : "Revenue"]
                    }
                  />
                  <Legend />
                  <Bar dataKey="spend" name="Spend" fill={COLORS[0]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="revenue" name="Revenue" fill={COLORS[2]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3>Top campaigns by spend</h3>
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
                      <td className="num">{fmt(c.roas, "ratio")}</td>
                      <td className="num">{fmt(c.margin_pct, "pct")}</td>
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
