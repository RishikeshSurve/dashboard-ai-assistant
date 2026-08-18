import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import Dashboard from "./components/Dashboard";
import Overview from "./components/Overview";
import TipsPanel from "./components/TipsPanel";
import { AuthError, clearToken, getToken, runQuery, type QueryResult } from "./api";

// Code-split: the login gate pulls in three.js for its background scene (~250KB gzipped).
// Returning users with a valid session token skip the gate entirely, so there's no reason to
// make them download that chunk -- only fetched when someone actually needs to log in.
const AccessGate = lazy(() => import("./components/AccessGate"));

const EXAMPLE_PROMPTS = [
  "Show spend, clicks and conversions by platform for the last 30 days",
  "Total spend and revenue for the last 14 days compared to previous period",
  "Spend trend over the last 30 days",
  "CTR and CPA by platform, last 7 days",
  "Total spend and revenue in 2025",
];

type Theme = "light" | "dark";
const THEME_KEY = "dashboard_theme";

function getInitialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      data-mode={theme}
      onClick={() => onChange(theme === "light" ? "dark" : "light")}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="theme-toggle-thumb" />
      <span className={`theme-toggle-option${theme === "light" ? " active" : ""}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className={`theme-toggle-option${theme === "dark" ? " active" : ""}`}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => Boolean(getToken()));
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<{ prompt: string; result?: QueryResult; error?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [tab, setTab] = useState<"overview" | "chat">("overview");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const handleAuthError = useCallback((message: string) => {
    clearToken();
    setUnlocked(false);
    setHistory([]);
    // surfaced implicitly by returning to the gate; message is available if we want a toast later
    void message;
  }, []);

  function handleLogout() {
    clearToken();
    setUnlocked(false);
    setHistory([]);
  }

  async function handleSubmit(p: string) {
    const text = p.trim();
    if (!text || loading) return;
    setLoading(true);
    setPrompt("");
    try {
      const result = await runQuery(text);
      setHistory((h) => [...h, { prompt: text, result }]);
    } catch (err: any) {
      if (err instanceof AuthError) {
        handleAuthError(err.message);
        return;
      }
      setHistory((h) => [...h, { prompt: text, error: err.message ?? String(err) }]);
    } finally {
      setLoading(false);
    }
  }

  if (!unlocked) {
    return (
      <Suspense fallback={<div className="access-gate-loading" />}>
        <AccessGate onUnlocked={() => setUnlocked(true)} />
      </Suspense>
    );
  }

  const lastTurn = history[history.length - 1];
  const lastEmpty = Boolean(lastTurn?.result && lastTurn.result.row_count === 0);
  const lastError = lastTurn?.error ?? null;

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>Dashboard AI Assistant</h1>
          <div className="header-actions">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <button className="logout-link" onClick={handleLogout} type="button">
              Log out
            </button>
          </div>
        </div>
        <p className="subtitle">
          {tab === "overview"
            ? "Key performance at a glance. Switch to Ask AI for custom questions in plain English."
            : "Ask for the data you need in plain English. Results render as a dashboard and can be exported as CSV or Excel for verification."}
        </p>
        <nav className="tabs">
          <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button type="button" className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
            Ask AI
          </button>
        </nav>
      </header>

      {tab === "overview" && <Overview onAuthError={handleAuthError} />}

      {tab === "chat" && (
        <div className="main-layout">
          <div className="main-column">
            <div className="examples">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button key={ex} onClick={() => handleSubmit(ex)} disabled={loading}>
                  {ex}
                </button>
              ))}
            </div>

            <div className="conversation">
              {history.map((turn, i) => (
                <div className="turn" key={i}>
                  <div className="user-prompt">{turn.prompt}</div>
                  {turn.error && <div className="error">{turn.error}</div>}
                  {turn.result && <Dashboard result={turn.result} onAuthError={handleAuthError} />}
                </div>
              ))}
              {loading && <div className="loading">Fetching data...</div>}
            </div>

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(prompt);
              }}
            >
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='e.g. "Show me spend and revenue by platform for the last 30 days"'
              />
              <button type="submit" disabled={loading}>
                Ask
              </button>
            </form>
          </div>

          <TipsPanel onSuggest={handleSubmit} lastEmpty={lastEmpty} lastError={lastError} />
        </div>
      )}
    </div>
  );
}
