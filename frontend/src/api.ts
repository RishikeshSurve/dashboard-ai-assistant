// Thin client for the Dashboard AI Assistant backend.
// In dev, Vite proxies /api -> http://localhost:8000 (see vite.config.ts).
// In production, set VITE_API_BASE_URL to your deployed backend URL.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ComparisonEntry {
  current: number | null;
  previous: number | null;
  delta_pct: number | null;
}

export interface QueryResult {
  query_id: string;
  sql: string;
  columns: string[];
  rows: Record<string, string | number>[];
  row_count: number;
  // null = grand total (render as score cards), "date" = render as a line chart,
  // anything else = render as a bar chart grouped by that dimension.
  dimension: string | null;
  // Present only for totals queries that asked for a period/YoY comparison. Keyed by metric
  // name, plus a "_range" entry describing the comparison window.
  comparison: (Record<string, ComparisonEntry> & { _range?: { previous_from: string; previous_to: string; mode: string } }) | null;
}

export async function runQuery(prompt: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function exportUrl(queryId: string, format: "csv" | "xlsx"): string {
  return `${API_BASE}/api/export/${queryId}.${format}`;
}

export async function fetchSchema(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/schema`);
  const data = await res.json();
  return data.description;
}
