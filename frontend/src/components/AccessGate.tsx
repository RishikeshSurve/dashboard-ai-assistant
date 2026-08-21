import { useState } from "react";
import { verifyAccessCode } from "../api";

type Status = "idle" | "loading" | "success" | "error";

/** Full-bleed decorative background: an original "data analysis hero" illustration -- a
 *  blue-to-indigo gradient with a dot-grid texture, a screen showing a chart, a floating
 *  stat card, a rising bar chart, a flowing area chart and a phone mockup, clustered on the
 *  left so the login card (positioned via CSS on the right, see .access-gate) sits on clear
 *  background. Every shape here is hand-built from scratch in the app's own palette -- not a
 *  traced/stock image, so there's nothing borrowed and nothing to watermark. Purely
 *  decorative -- aria-hidden. No per-frame JS or WebGL, so this can't reintroduce the
 *  input-lag issue the old three.js background caused. */
function AnalyticsHeroBackground() {
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
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="45%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#2e1065" />
        </linearGradient>
        <pattern id="dotGrid" width="34" height="34" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="rgba(255,255,255,0.35)" />
        </pattern>
        <radialGradient id="glowOrange" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glowPink2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f472b6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#f472b6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="barPink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbcfe8" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
        <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ec4899" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="waveStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>

      <rect width="1600" height="900" fill="url(#bgGrad)" />
      <rect width="1600" height="900" fill="url(#dotGrid)" opacity="0.55" />
      <ellipse cx="430" cy="560" rx="320" ry="100" fill="rgba(255,255,255,0.05)" />
      <circle cx="360" cy="140" r="240" fill="url(#glowOrange)" />
      <circle cx="140" cy="640" r="220" fill="url(#glowPink2)" />

      {/* Screen with a chart -- the illustration's centerpiece */}
      <g transform="translate(190,90)">
        <rect width="340" height="220" rx="16" fill="#f8fafc" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
        <path d="M0 16a16 16 0 0 1 16-16h308a16 16 0 0 1 16 16v18H0Z" fill="#fb923c" />
        <circle cx="20" cy="17" r="4" fill="#fff" opacity="0.85" />
        <circle cx="34" cy="17" r="4" fill="#fff" opacity="0.6" />
        <circle cx="48" cy="17" r="4" fill="#fff" opacity="0.4" />
        <circle cx="72" cy="112" r="32" fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle cx="72" cy="112" r="32" fill="none" stroke="#2563eb" strokeWidth="14" strokeDasharray="86 115" strokeLinecap="round" />
        <circle cx="72" cy="112" r="32" fill="none" stroke="#fb923c" strokeWidth="14" strokeDasharray="32 115" strokeDashoffset="-86" strokeLinecap="round" />
        <rect x="180" y="60" width="18" height="46" rx="3" fill="#93c5fd" />
        <rect x="204" y="42" width="18" height="64" rx="3" fill="#2563eb" />
        <rect x="228" y="70" width="18" height="36" rx="3" fill="#93c5fd" />
        <rect x="252" y="30" width="18" height="76" rx="3" fill="#1d4ed8" />
        <rect x="276" y="56" width="18" height="50" rx="3" fill="#93c5fd" />
        <rect x="300" y="20" width="18" height="86" rx="3" fill="#2563eb" />
        <polyline
          points="24,190 70,168 116,180 162,150 208,162 254,132 300,146"
          fill="none"
          stroke="#ec4899"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Small floating summary card, tucked above-left of the screen */}
      <g transform="translate(120,44) rotate(-3)">
        <rect width="140" height="86" rx="12" fill="#ffffff" stroke="rgba(0,0,0,0.04)" strokeWidth="1.5" />
        <rect x="16" y="18" width="10" height="50" rx="3" fill="#fdba74" />
        <rect x="32" y="30" width="10" height="38" rx="3" fill="#fb923c" />
        <rect x="48" y="14" width="10" height="54" rx="3" fill="#ea580c" />
        <circle cx="104" cy="42" r="24" fill="none" stroke="#dbeafe" strokeWidth="9" />
        <circle cx="104" cy="42" r="24" fill="none" stroke="#2563eb" strokeWidth="9" strokeDasharray="60 91" strokeLinecap="round" />
      </g>

      {/* Rising bar chart, lower-left -- each bar has a lighter "top" face for a touch of depth */}
      <g transform="translate(70,470)">
        {[
          { x: 0, h: 70 },
          { x: 62, h: 120 },
          { x: 124, h: 175 },
          { x: 186, h: 235 },
        ].map((bar) => (
          <g key={bar.x} transform={`translate(${bar.x},0)`}>
            <rect y={260 - bar.h} width="46" height={bar.h} rx="6" fill="url(#barPink)" />
            <polygon
              points={`0,${260 - bar.h} 46,${260 - bar.h} 38,${252 - bar.h} -8,${252 - bar.h}`}
              fill="#fce7f3"
            />
          </g>
        ))}
      </g>

      {/* Flowing area chart, lower-right of the cluster */}
      <g transform="translate(500,480)">
        <path
          d="M0,150 C40,110 70,170 110,120 C150,70 190,140 230,90 L260,90 L260,190 L0,190 Z"
          fill="url(#waveFill)"
        />
        <path
          d="M0,150 C40,110 70,170 110,120 C150,70 190,140 230,90 L260,90"
          fill="none"
          stroke="url(#waveStroke)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </g>

      {/* Phone mockup, right of the screen */}
      <g transform="translate(560,140) rotate(4)">
        <rect width="76" height="150" rx="16" fill="#111827" />
        <rect x="6" y="12" width="64" height="118" rx="8" fill="#eef2ff" />
        <polyline points="14,90 26,70 38,80 50,54 62,66" fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="62" cy="66" r="3.4" fill="#fb923c" />
        <rect x="14" y="102" width="48" height="6" rx="3" fill="#c7d2fe" />
        <rect x="14" y="114" width="32" height="6" rx="3" fill="#c7d2fe" />
      </g>

      {/* Scattered accent dots for polish */}
      <circle cx="60" cy="120" r="5" fill="#fb923c" opacity="0.7" />
      <circle cx="700" cy="70" r="4" fill="#f472b6" opacity="0.6" />
      <circle cx="780" cy="420" r="5" fill="#93c5fd" opacity="0.5" />
      <circle cx="40" cy="700" r="4" fill="#fbcfe8" opacity="0.6" />
    </svg>
  );
}

/** Full-screen invite-code gate shown before the chat UI: an original "data analysis" hero
 *  illustration (see AnalyticsHeroBackground above) on the left, with a glass login card
 *  anchored to the right (see .access-gate's flex layout in styles.css). On success, plays a
 *  short "unlocked" animation before calling onUnlocked(). */
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
      <AnalyticsHeroBackground />
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
