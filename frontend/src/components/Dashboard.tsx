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
import { exportUrl } from "../api";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function formatMetricName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Score cards: used when the query has no dimension breakdown (a grand total). */
function ScoreCards({ result }: { result: QueryResult }) {
  const row = result.rows[0] ?? {};
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
            <div className="score-card-value">{formatValue(row[metric])}</div>
            {typeof delta === "number" && (
              <div className={`score-card-delta ${isUp ? "up" : isDown ? "down" : "flat"}`}>
                {isUp ? "▲" : isDown ? "▼" : "–"} {Math.abs(delta)}%
                <span className="score-card-delta-label">
                  {" "}
                  vs {result.comparison?._range?.mode === "yoy" ? "last year" : "previous period"}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard({ result }: { result: QueryResult }) {
  const dimensionCol = result.dimension;
  const metricCols = dimensionCol ? result.columns.filter((c) => c !== dimensionCol) : result.columns;
  const isTotals = !dimensionCol;
  const isTrend = dimensionCol === "date";

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>{isTotals ? "Summary" : `Results (${result.row_count} rows)`}</h2>
        <div className="export-buttons">
          <a href={exportUrl(result.query_id, "csv")} download>
            Download CSV
          </a>
          <a href={exportUrl(result.query_id, "xlsx")} download>
            Download Excel
          </a>
        </div>
      </div>

      {isTotals && result.rows.length > 0 && <ScoreCards result={result} />}

      {!isTotals && result.rows.length > 0 && (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            {isTrend ? (
              <LineChart data={result.rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={dimensionCol!} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={dimensionCol!} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
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
                {result.columns.map((c) => (
                  <td key={c}>{row[c]}</td>
                ))}
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
