import { useState } from "react";
import AccessGate from "./components/AccessGate";
import Dashboard from "./components/Dashboard";
import { AuthError, clearToken, getToken, runQuery, type QueryResult } from "./api";

const EXAMPLE_PROMPTS = [
  "Show spend, clicks and conversions by platform for the last 30 days",
  "Total spend and revenue for the last 14 days compared to previous period",
  "Spend trend over the last 30 days",
  "CTR and CPA by platform, last 7 days",
  "Total spend and revenue in 2025",
];

export default function App() {
  const [unlocked, setUnlocked] = useState(() => Boolean(getToken()));
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<{ prompt: string; result?: QueryResult; error?: string }[]>([]);
  const [loading, setLoading] = useState(false);

  function handleAuthError(message: string) {
    clearToken();
    setUnlocked(false);
    setHistory([]);
    // surfaced implicitly by returning to the gate; message is available if we want a toast later
    void message;
  }

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
    return <AccessGate onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>Dashboard AI Assistant</h1>
          <button className="logout-link" onClick={handleLogout} type="button">
            Log out
          </button>
        </div>
        <p className="subtitle">
          Ask for the data you need in plain English. Results render as a dashboard and can be
          exported as CSV or Excel for verification.
        </p>
      </header>

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
  );
}
