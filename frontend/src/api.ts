// Thin client for the Dashboard AI Assistant backend.
// In dev, Vite proxies /api -> http://localhost:8000 (see vite.config.ts).
// In production, set VITE_API_BASE_URL to your deployed backend URL.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "dashboard_access_token";

/** Thrown whenever the backend rejects a request for missing/expired/invalid auth, so callers
 *  can distinguish "show the access-code gate again" from a normal query error. */
export class AuthError extends Error {}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Submits the invite-only access code. On success, stores the session token and returns the
 *  label associated with the code (useful if you hand out different codes to different people). */
export async function verifyAccessCode(code: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "That access code isn't valid.");
  }
  const data = await res.json();
  setToken(data.token);
  return data.label as string;
}

/** fetch() wrapper that attaches the bearer token and normalizes a 401 into AuthError so the
 *  UI can drop back to the access-code gate instead of showing a generic error message. */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    const body = await res.json().catch(() => ({}));
    throw new AuthError(body.detail ?? "Your session expired. Enter your access code again.");
  }
  return res;
}

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
  const res = await authFetch("/api/query", {
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

/** Downloads the export as a file. Auth requires a header, so this can't be a plain <a href> —
 *  it fetches the bytes with the bearer token and triggers the browser download itself. */
export async function exportFile(queryId: string, format: "csv" | "xlsx"): Promise<void> {
  const res = await authFetch(`/api/export/${queryId}.${format}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dashboard_${queryId.slice(0, 8)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchSchema(): Promise<string> {
  const res = await authFetch("/api/schema");
  const data = await res.json();
  return data.description;
}

export type OverviewPeriod = "last30" | "this_month" | "ytd";

export interface KpiEntry {
  current: number | null;
  previous: number | null;
  delta_pct: number | null;
}

export interface OverviewData {
  period: { from: string; to: string; label: string; key: string };
  previous_period: { from: string; to: string };
  kpis: Record<string, KpiEntry>;
  trend: { date: string; spend: number; revenue: number; conversions: number }[];
  platforms: { platform: string; spend: number; revenue: number; conversions: number; roas: number }[];
  campaigns: { campaign: string; spend: number; revenue: number; conversions: number; roas: number; margin_pct: number | null }[];
}

/** One round trip for the whole Overview dashboard -- KPIs, trend, platforms, campaigns. */
export async function fetchOverview(period: OverviewPeriod): Promise<OverviewData> {
  const res = await authFetch(`/api/overview?period=${period}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Overview failed (${res.status})`);
  }
  return res.json();
}
