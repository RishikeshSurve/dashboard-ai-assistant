// Thin client for the Dashboard AI Assistant backend.
// In dev, Vite proxies /api -> http://localhost:8000 (see vite.config.ts).
// In production, set VITE_API_BASE_URL to your deployed backend URL.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface QueryResult {
  query_id: string;
  sql: string;
  columns: string[];
  rows: Record<string, string | number>[];
  row_count: number;
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
