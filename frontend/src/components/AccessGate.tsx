import { useRef, useState } from "react";
import { verifyAccessCode } from "../api";
import LoginBackground3D from "./LoginBackground3D";

type Status = "idle" | "loading" | "success" | "error";

/** Full-screen gate shown before the chat UI. Submits the invite-only access code, and on
 *  success plays a short "unlocked" animation before calling onUnlocked() to swap in the app.
 *  The background is a full-page 3D scene (LoginBackground3D); the card itself tilts toward
 *  the cursor with a glass glare highlight for extra depth. */
export default function AccessGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [showCode, setShowCode] = useState(false);
  const [shake, setShake] = useState(false);
  const gateRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);

  const loading = status === "loading";
  const success = status === "success";

  function handleMouseMove(e: React.MouseEvent) {
    const gate = gateRef.current;
    const card = cardRef.current;
    const glare = glareRef.current;
    if (!gate || !card || !glare) return;
    const rect = gate.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 16;
    const rotateX = (0.5 - py) * 16;
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    glare.style.opacity = "1";
    glare.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,0.18), transparent 55%)`;
  }

  function handleMouseLeave() {
    const card = cardRef.current;
    const glare = glareRef.current;
    if (card) card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
    if (glare) glare.style.opacity = "0";
  }

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
    <div className="access-gate" ref={gateRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <LoginBackground3D />

      <div className="card-wrap">
        <form
          ref={cardRef}
          className={`access-gate-card${shake ? " shake" : ""}${success ? " success" : ""}`}
          onSubmit={handleSubmit}
        >
          <div className="access-gate-shine" />
          <div className="access-gate-glare" ref={glareRef} />

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

          <h1>{success ? "Access granted" : "Scout"}</h1>
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
    </div>
  );
}
