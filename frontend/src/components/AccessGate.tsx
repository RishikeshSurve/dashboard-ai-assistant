import { useState } from "react";
import { verifyAccessCode } from "../api";

type Status = "idle" | "loading" | "success" | "error";

/** Full-bleed decorative background: a dark "data hologram" scene (grid floor, glowing
 *  chart panels, a dotted world map, a network of connector lines) built entirely from
 *  original SVG shapes in the app's own palette -- not a traced/stock image, so there's
 *  nothing borrowed and nothing to watermark. Purely decorative -- aria-hidden. The only
 *  motion is a couple of native SVG <animate> opacity pulses on the map's node dots, which
 *  the browser handles natively (no per-frame JS, no WebGL) -- cheap enough to never risk
 *  the input-lag issue the old three.js background caused. */
function HologramBackground() {
  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="access-gate-bg"
    >
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#121935" />
          <stop offset="55%" stopColor="#05060f" />
          <stop offset="100%" stopColor="#000002" />
        </linearGradient>
        <radialGradient id="glowPurple" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8b7ff9" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#8b7ff9" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glowCyan" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glowPink" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f472b6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#f472b6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
          <stop offset="55%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.6" />
        </radialGradient>
        <pattern id="floorGrid" width="80" height="60" patternUnits="userSpaceOnUse">
          <path d="M80 0H0V60" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="1600" height="900" fill="url(#bgGrad)" />
      <rect width="1600" height="900" fill="url(#floorGrid)" opacity="0.6" />
      <circle cx="260" cy="180" r="280" fill="url(#glowPurple)" />
      <circle cx="1370" cy="700" r="320" fill="url(#glowCyan)" />
      <circle cx="1460" cy="140" r="200" fill="url(#glowPink)" />

      {/* Faint connector lines threading the panels together, "network" feel */}
      <g stroke="rgba(255,255,255,0.08)" strokeWidth="1.2">
        <line x1="400" y1="175" x2="760" y2="230" />
        <line x1="1180" y1="210" x2="820" y2="260" />
        <line x1="270" y1="560" x2="500" y2="330" />
        <line x1="1140" y1="600" x2="900" y2="380" />
      </g>

      {/* Panel: bar chart (top-left) */}
      <g transform="translate(60,60)">
        <rect width="340" height="210" rx="16" fill="rgba(15,20,40,0.55)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="5" fill="#ef4444" opacity="0.8" />
        <circle cx="42" cy="24" r="5" fill="#f59e0b" opacity="0.8" />
        <circle cx="60" cy="24" r="5" fill="#10b981" opacity="0.8" />
        <rect x="24" y="150" width="24" height="40" rx="4" fill="#22d3ee" />
        <rect x="60" y="120" width="24" height="70" rx="4" fill="#8b7ff9" />
        <rect x="96" y="90" width="24" height="100" rx="4" fill="#f472b6" />
        <rect x="132" y="130" width="24" height="60" rx="4" fill="#22d3ee" opacity="0.7" />
        <rect x="168" y="70" width="24" height="120" rx="4" fill="#a855f7" />
        <rect x="204" y="110" width="24" height="80" rx="4" fill="#f59e0b" />
        <rect x="240" y="60" width="24" height="130" rx="4" fill="#10b981" />
        <rect x="276" y="140" width="24" height="50" rx="4" fill="#22d3ee" opacity="0.6" />
      </g>

      {/* Panel: donut + trend (top-right) */}
      <g transform="translate(1180,80)">
        <rect width="360" height="230" rx="16" fill="rgba(15,20,40,0.55)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
        <circle cx="95" cy="115" r="58" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" />
        <circle cx="95" cy="115" r="58" fill="none" stroke="#22d3ee" strokeWidth="16" strokeDasharray="130 234" strokeLinecap="round" />
        <circle cx="95" cy="115" r="58" fill="none" stroke="#8b7ff9" strokeWidth="16" strokeDasharray="70 234" strokeDashoffset="-130" strokeLinecap="round" />
        <circle cx="95" cy="115" r="58" fill="none" stroke="#f472b6" strokeWidth="16" strokeDasharray="34 234" strokeDashoffset="-200" strokeLinecap="round" />
        <polyline points="185,180 210,150 235,165 260,120 285,135 310,88" fill="none" stroke="#facc15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="310" cy="88" r="5" fill="#facc15" />
      </g>

      {/* Panel: dotted world map with pulsing nodes (bottom-left) */}
      <g transform="translate(90,540)">
        <rect width="400" height="240" rx="16" fill="rgba(15,20,40,0.55)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
        <g fill="rgba(255,255,255,0.22)">
          <circle cx="40" cy="60" r="2.4" /><circle cx="58" cy="72" r="2.4" /><circle cx="76" cy="58" r="2.4" />
          <circle cx="94" cy="70" r="2.4" /><circle cx="112" cy="55" r="2.4" /><circle cx="130" cy="68" r="2.4" />
          <circle cx="60" cy="90" r="2.4" /><circle cx="80" cy="95" r="2.4" /><circle cx="100" cy="88" r="2.4" />
          <circle cx="180" cy="60" r="2.4" /><circle cx="198" cy="72" r="2.4" /><circle cx="216" cy="58" r="2.4" />
          <circle cx="234" cy="66" r="2.4" /><circle cx="200" cy="90" r="2.4" /><circle cx="220" cy="98" r="2.4" />
          <circle cx="280" cy="120" r="2.4" /><circle cx="298" cy="132" r="2.4" /><circle cx="316" cy="118" r="2.4" />
          <circle cx="334" cy="128" r="2.4" /><circle cx="300" cy="150" r="2.4" /><circle cx="320" cy="158" r="2.4" />
          <circle cx="150" cy="140" r="2.4" /><circle cx="168" cy="152" r="2.4" /><circle cx="186" cy="145" r="2.4" />
          <circle cx="70" cy="160" r="2.4" /><circle cx="90" cy="172" r="2.4" /><circle cx="110" cy="165" r="2.4" />
        </g>
        <circle cx="120" cy="90" r="6" fill="#22d3ee">
          <animate attributeName="opacity" values="1;0.3;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="260" cy="140" r="6" fill="#f472b6">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2.8s" repeatCount="indefinite" />
        </circle>
        <circle cx="310" cy="70" r="6" fill="#facc15">
          <animate attributeName="opacity" values="1;0.4;1" dur="3.2s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Panel: readouts + sparkline (bottom-right) */}
      <g transform="translate(1140,520)">
        <rect width="380" height="260" rx="16" fill="rgba(15,20,40,0.55)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
        <rect x="24" y="24" width="150" height="46" rx="10" fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.35)" />
        <circle cx="46" cy="47" r="6" fill="#22d3ee" />
        <rect x="64" y="38" width="86" height="8" rx="4" fill="rgba(255,255,255,0.35)" />
        <rect x="24" y="82" width="150" height="46" rx="10" fill="rgba(139,127,249,0.12)" stroke="rgba(139,127,249,0.35)" />
        <circle cx="46" cy="105" r="6" fill="#8b7ff9" />
        <rect x="64" y="96" width="64" height="8" rx="4" fill="rgba(255,255,255,0.35)" />
        <rect x="200" y="150" width="14" height="60" rx="3" fill="#f472b6" />
        <rect x="222" y="120" width="14" height="90" rx="3" fill="#22d3ee" />
        <rect x="244" y="160" width="14" height="50" rx="3" fill="#facc15" />
        <rect x="266" y="100" width="14" height="110" rx="3" fill="#8b7ff9" />
        <rect x="288" y="140" width="14" height="70" rx="3" fill="#10b981" />
        <rect x="310" y="80" width="14" height="130" rx="3" fill="#22d3ee" opacity="0.7" />
      </g>

      <rect width="1600" height="900" fill="url(#vignette)" />
    </svg>
  );
}

/** Full-screen invite-code gate shown before the chat UI: a dark "data hologram" background
 *  (original artwork -- see HologramBackground above) with a centered glass card holding the
 *  form. On success, plays a short "unlocked" animation before calling onUnlocked(). */
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
      <HologramBackground />
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
      </div>
    </div>
  );
}
