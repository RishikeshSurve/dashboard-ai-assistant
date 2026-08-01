import { useMemo, useState } from "react";
import { verifyAccessCode } from "../api";

type Status = "idle" | "loading" | "success" | "error";

/** Decorative twinkling particles behind the card. Positions/delays are randomized once per
 *  mount (purely visual, no need to be deterministic). */
function useParticles(count: number) {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 2 + Math.random() * 3,
        delay: Math.random() * 6,
        duration: 4 + Math.random() * 4,
      })),
    [count]
  );
}

/** Full-screen gate shown before the chat UI. Submits the invite-only access code, and on
 *  success plays a short "unlocked" animation before calling onUnlocked() to swap in the app. */
export default function AccessGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [showCode, setShowCode] = useState(false);
  const [shake, setShake] = useState(false);
  const particles = useParticles(18);

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
      window.setTimeout(onUnlocked, 900);
    } catch (err: any) {
      setStatus("error");
      setError(err.message ?? "That access code isn't valid.");
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
    }
  }

  return (
    <div className="access-gate">
      <div className="access-gate-orb orb-1" />
      <div className="access-gate-orb orb-2" />
      <div className="access-gate-orb orb-3" />
      <div className="access-gate-orb orb-4" />
      <div className="access-gate-aura" />
      <div className="access-gate-grid" />
      <div className="access-gate-particles">
        {particles.map((p) => (
          <span
            key={p.id}
            className="particle"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }}
          />
        ))}
      </div>

      <form
        className={`access-gate-card${shake ? " shake" : ""}${success ? " success" : ""}`}
        onSubmit={handleSubmit}
      >
        <div className="access-gate-shine" />

        <div className={`access-gate-icon${success ? " success" : ""}`}>
          {success ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                className="check-path"
                d="M5 12.5l4.5 4.5L19 7"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="white" strokeWidth="1.7" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
              <circle cx="12" cy="15" r="1.6" fill="white" />
            </svg>
          )}
        </div>

        <h1>{success ? "Access granted" : "Dashboard AI Assistant"}</h1>
        <p className="subtitle">{success ? "Unlocking your dashboard..." : "Enter your access code to continue"}</p>

        {!success && (
          <>
            <div className={`access-gate-input-wrap${error ? " has-error" : ""}`}>
              <input
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
                placeholder="Access code"
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
                "Enter"
              )}
            </button>

            <p className="access-gate-footnote">Invite-only access &middot; ask an admin for a code</p>
          </>
        )}

        {success && <div className="access-gate-progress" />}
      </form>
    </div>
  );
}
