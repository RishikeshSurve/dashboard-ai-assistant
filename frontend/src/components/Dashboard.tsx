import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { QueryResult } from "../api";
import { exportUrl } from "../api";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function Dashboard({ result }: { result: QueryResult }) {
  const dimensionCol = result.columns[0];
  const metricCols = result.columns.slice(1);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Results ({result.row_count} rows)</h2>
        <div className="export-buttons">
          <a href={exportUrl(result.query_id, "csv")} download>
            Download CSV
          </a>
          <a href={exportUrl(result.query_id, "xlsx")} download>
            Download Excel
          </a>
        </div>
      </div>

      {result.rows.length > 0 && (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={result.rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={dimensionCol} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              {metricCols.map((col, i) => (
                <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
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
