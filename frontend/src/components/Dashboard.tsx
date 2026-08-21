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
import type { QueryResult } from "../api";
import { AuthError, exportFile } from "../api";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function formatMetricName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPercentMetric(metricName: string): boolean {
  return metricName.toLowerCase().includes("pct");
}

/** Rounds to at most 2 decimal places and appends "%" for percentage-style metrics
 *  (e.g. margin_pct) so numbers stay clean and presentable everywhere they're shown. */
function formatValue(value: number | string | null | undefined, metricName?: string): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return String(value);
  const formatted = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return metricName && isPercentMetric(metricName) ? `${formatted}%` : formatted;
}

/** Formats an ISO date as "Jul 1, 2026", or "Jul 1 – Jul 15, 2026" for a range, so the
 *  comparison badge can show exactly which dates it's comparing against instead of leaving
 *  people to guess what "previous period" resolved to. */
function formatDateRange(from: string, to: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

// Theme-aware chart chrome (grid lines, axis ticks, tooltip) via CSS variables -- without this,
// Recharts falls back to its own default gray/white styling, which reads fine in light mode but
// goes muddy or glaringly bright-white against a dark/black page.
const AXIS_TICK_STYLE = { fontSize: 12, fill: "var(--text-secondary)" };
const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-secondary)", fontWeight: 600 },
} as const;

const COMPARISON_EXPLANATIONS: Record<string, string> = {
  yoy: "Year over year: compared to the exact same calendar dates one year earlier.",
  previous_period:
    "Previous period: compared to the equivalent stretch of time right before this one " +
    "(the previous calendar month for a full/partial month, or the same number of days " +
    "immediately prior for other ranges).",
};

/** Score cards: used when the query has no dimension breakdown (a grand total). */
function ScoreCards({ result }: { result: QueryResult }) {
  const row = result.rows[0] ?? {};
  const mode = result.comparison?._range?.mode;
  const modeLabel = mode === "yoy" ? "last year" : "previous period";
  const modeExplanation = mode ? COMPARISON_EXPLANATIONS[mode] : undefined;
  const range = result.comparison?._range;

  return (
    <div className="score-cards">
      {result.columns.map((metric) => {
        const cmp = result.comparison?.[metric];
        const delta = cmp?.delta_pct;
        const isUp = typeof delta === "number" && delta > 0;
        const isDown = typeof delta === "number" && delta < 0;
        return (
          <div className="score-card" key={metric}>
            <div className="score-card-label">{formatMetricName(metric)}</div>
            <div className="score-card-value">{formatValue(row[metric], metric)}</div>
            {typeof delta === "number" && (
              <div className={`score-card-delta ${isUp ? "up" : isDown ? "down" : "flat"}`}>
                {isUp ? "▲" : isDown ? "▼" : "–"} {Math.abs(delta)}%
                <span
                  className="score-card-delta-label"
                  title={
                    modeExplanation && cmp
                      ? `${modeExplanation}\nThis metric: ${formatValue(cmp.current, metric)} vs ${formatValue(cmp.previous, metric)}.`
                      : modeExplanation
                  }
                >
                  {" "}
                  vs {modeLabel}
                  {range && <span className="score-card-delta-range"> ({formatDateRange(range.previous_from, range.previous_to)})</span>}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard({
  result,
  onAuthError,
}: {
  result: QueryResult;
  onAuthError?: (message: string) => void;
}) {
  const dimensionCol = result.dimension;
  // _prev/_change helper columns (grouped comparisons) belong in the table, not as extra
  // chart series -- charting them doubles every line/bar and buries the actual metrics.
  const isHelperCol = (c: string) => c.endsWith("_prev") || c.endsWith("_change");
  const metricCols = dimensionCol
    ? result.columns.filter((c) => c !== dimensionCol && !isHelperCol(c))
    : result.columns.filter((c) => !isHelperCol(c));
  const isTotals = !dimensionCol;
  const isTrend = dimensionCol === "date";

  async function handleExport(format: "csv" | "xlsx") {
    try {
      await exportFile(result.query_id, format);
    } catch (err: any) {
      if (err instanceof AuthError && onAuthError) {
        onAuthError(err.message);
      } else {
        alert(err?.message ?? "Export failed.");
      }
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>{isTotals ? "Summary" : `Results (${result.row_count} rows)`}</h2>
        <div className="export-buttons">
          <button type="button" onClick={() => handleExport("csv")}>
            Download CSV
          </button>
          <button type="button" onClick={() => handleExport("xlsx")}>
            Download Excel
          </button>
        </div>
      </div>

      {dimensionCol && result.comparison?._range && (
        <p className="compare-note">
          _prev and _change columns compare against{" "}
          {result.comparison._range.mode === "yoy" ? "the same dates last year" : "the previous period"} (
          {formatDateRange(result.comparison._range.previous_from, result.comparison._range.previous_to)}).
        </p>
      )}

      {isTotals && result.rows.length > 0 && <ScoreCards result={result} />}

      {!isTotals && result.rows.length > 0 && (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            {isTrend ? (
              <LineChart data={result.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey={dimensionCol!} tick={AXIS_TICK_STYLE} />
                <YAxis tick={AXIS_TICK_STYLE} />
                <Tooltip
                  formatter={(value: number, name: string) => [formatValue(value, name), formatMetricName(name)]}
                  {...TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={{ color: "var(--text-secondary)" }} />
                {metricCols.map((col, i) => (
                  <Line
                    key={col}
                    type="monotone"
                    dataKey={col}
                    stroke={COLORS[i % COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={result.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey={dimensionCol!} tick={AXIS_TICK_STYLE} />
                <YAxis tick={AXIS_TICK_STYLE} />
                <Tooltip
                  formatter={(value: number, name: string) => [formatValue(value, name), formatMetricName(name)]}
                  cursor={{ fill: "var(--surface-muted)" }}
                  {...TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={{ color: "var(--text-secondary)" }} />
                {metricCols.map((col, i) => (
                  <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {result.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                {result.columns.map((c) => {
                  const raw = row[c];
                  const changeClass =
                    c.endsWith("_change") && typeof raw === "number" ? (raw > 0 ? " pos" : raw < 0 ? " neg" : "") : "";
                  return (
                    <td key={c} className={changeClass || undefined}>
                      {c === dimensionCol ? raw : formatValue(raw, c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="sql-details">
        <summary>View generated SQL (for verification)</summary>
        <pre>{result.sql}</pre>
      </details>
    </div>
  );
}
