import { useState } from "react";
import { verifyAccessCode } from "../api";

type Status = "idle" | "loading" | "success" | "error";

/** Decorative dashboard-mockup illustration for the right-hand panel. Original artwork (not a
 *  traced/stock image) built from the app's own palette so it stays visually consistent with
 *  the charts people see once they're in. Purely decorative -- aria-hidden. */
function DashboardIllustration() {
  return (
    <svg viewBox="0 0 420 360" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="login-illustration-svg">
      <ellipse cx="210" cy="330" rx="150" ry="16" fill="#4f46e5" opacity="0.08" />

      {/* Monitor frame */}
      <rect x="55" y="40" width="310" height="210" rx="14" fill="#ffffff" stroke="#e0e0f5" strokeWidth="2" />
      <rect x="55" y="40" width="310" height="34" rx="14" fill="#f2f1fd" />
      <circle cx="72" cy="57" r="4" fill="#ef4444" />
      <circle cx="86" cy="57" r="4" fill="#f59e0b" />
      <circle cx="100" cy="57" r="4" fill="#10b981" />
      <rect x="70" y="240" width="270" height="10" rx="5" fill="#f2f1fd" />

      {/* Bar chart */}
      <rect x="80" y="170" width="22" height="55" rx="4" fill="#8b7ff9" />
      <rect x="112" y="140" width="22" height="85" rx="4" fill="#4f46e5" />
      <rect x="144" y="190" width="22" height="35" rx="4" fill="#a855f7" />
      <rect x="176" y="155" width="22" height="70" rx="4" fill="#8b7ff9" />

      {/* Trend line */}
      <polyline points="80,120 115,105 150,112 185,88 220,96 255,72" fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="255" cy="72" r="5" fill="#22d3ee" />

      {/* Donut */}
      <circle cx="315" cy="150" r="34" fill="none" stroke="#f2f1fd" strokeWidth="12" />
      <circle cx="315" cy="150" r="34" fill="none" stroke="#4f46e5" strokeWidth="12" strokeDasharray="120 214" strokeLinecap="round" />
      <circle cx="315" cy="150" r="34" fill="none" stroke="#f59e0b" strokeWidth="12" strokeDasharray="45 214" strokeDashoffset="-120" strokeLinecap="round" />

      {/* Floating checklist card */}
      <g transform="translate(18 240)">
        <rect width="132" height="82" rx="14" fill="#ffffff" stroke="#e0e0f5" strokeWidth="2" />
        <circle cx="22" cy="22" r="8" fill="#e9e7fd" />
        <path d="M18 22l3 3 6-6" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="38" y="18" width="70" height="8" rx="4" fill="#f2f1fd" />
        <circle cx="22" cy="44" r="8" fill="#e9e7fd" />
        <path d="M18 44l3 3 6-6" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="38" y="40" width="55" height="8" rx="4" fill="#f2f1fd" />
        <circle cx="22" cy="66" r="8" fill="#e9e7fd" />
        <path d="M18 66l3 3 6-6" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="38" y="62" width="62" height="8" rx="4" fill="#f2f1fd" />
      </g>

      {/* Floating "+" bubble */}
      <g transform="translate(340 250)">
        <circle r="24" fill="#4f46e5" />
        <path d="M-9 0h18M0 -9v18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* Scattered accent dots */}
      <circle cx="40" cy="30" r="5" fill="#f472b6" opacity="0.7" />
      <circle cx="395" cy="60" r="4" fill="#22d3ee" opacity="0.7" />
      <circle cx="18" cy="180" r="4" fill="#a855f7" opacity="0.6" />
      <circle cx="400" cy="190" r="6" fill="#f59e0b" opacity="0.5" />
    </svg>
  );
}

/** Full-screen invite-code gate shown before the chat UI: a light, split-panel layout with the
 *  form on the left and a decorative product illustration on the right (hidden on narrow
 *  viewports). On success, plays a short "unlocked" animation before calling onUnlocked(). */
export default function AccessGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [showCode, setShowCode] = useState(false);
  const [shake, setShake] = useState(false);

  const loading = status === "loading";
  const success = status === "success";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || loading || success) return;
    setStatus("loading");
    setError(null);
    try {
      await verifyAccessCode(code.trim());
      setStatus("success");
      window.setTimeout(onUnlocked, 700);
    } catch (err: any) {
      setStatus("error");
      setError(err.message ?? "That access code isn't valid.");
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
    }
  }

  return (
    <div className="access-gate">
      <div className={`access-gate-card${shake ? " shake" : ""}`}>
        <div className="access-gate-form-panel">
          <div className={`access-gate-icon${success ? " success" : ""}`}>
            {success ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path className="check-path" d="M5 12.5l4.5 4.5L19 7" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="white" strokeWidth="1.8" />
                <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="12" cy="15" r="1.6" fill="white" />
              </svg>
            )}
          </div>

          <h1>{success ? "Access granted" : "Scout"}</h1>
          <p className="access-gate-subtitle">
            {success ? "Unlocking your dashboard..." : "Sign in with your invite-only access code"}
          </p>

          {!success && (
            <form onSubmit={handleSubmit}>
              <label className="access-gate-label" htmlFor="access-code-input">
                Access code
              </label>
              <div className={`access-gate-input-wrap${error ? " has-error" : ""}`}>
                <input
                  id="access-code-input"
                  type={showCode ? "text" : "password"}
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (error) {
                      setError(null);
                      setStatus("idle");
                    }
                  }}
                  placeholder="Enter your access code"
                  autoComplete="off"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowCode((s) => !s)}
                  tabIndex={-1}
                  aria-label={showCode ? "Hide access code" : "Show access code"}
                >
                  {showCode ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 3l18 18M10.6 10.7a2.5 2.5 0 0 0 3.5 3.5M9.4 5.5A10.6 10.6 0 0 1 12 5c5.5 0 9 4.5 10 7-0.4 1-1.2 2.3-2.4 3.5M6.3 6.9C4.4 8.1 3 9.9 2 12c1 2.5 4.5 7 10 7 1.3 0 2.5-.2 3.6-.6"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M2 12c1-2.5 4.5-7 10-7s9 4.5 10 7c-1 2.5-4.5 7-10 7s-9-4.5-10-7Z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  )}
                </button>
              </div>

              {error && <div className="access-gate-error">{error}</div>}

              <button type="submit" className="access-gate-submit" disabled={loading || !code.trim()}>
                {loading ? (
                  <>
                    <span className="spinner" /> Checking...
                  </>
                ) : (
                  "Log in"
                )}
              </button>

              <p className="access-gate-footnote">Invite-only access &middot; ask an admin for a code</p>
            </form>
          )}

          {success && <div className="access-gate-progress" />}
        </div>

        <div className="access-gate-illustration-panel" aria-hidden="true">
          <DashboardIllustration />
          <h2>Track every campaign at a glance</h2>
          <p>Ask questions in plain English and get instant dashboards, or check your Overview stats in one place.</p>
          <div className="access-gate-dots">
            <span className="active" />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
