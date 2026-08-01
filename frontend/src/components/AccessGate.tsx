import { useState } from "react";
import { verifyAccessCode } from "../api";

/** Full-screen gate shown before the chat UI. Submits the invite-only access code, and on
 *  success calls onUnlocked() so the parent can swap in the real app. */
export default function AccessGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await verifyAccessCode(code.trim());
      onUnlocked();
    } catch (err: any) {
      setError(err.message ?? "That access code isn't valid.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="access-gate">
      <form className="access-gate-card" onSubmit={handleSubmit}>
        <h1>Dashboard AI Assistant</h1>
        <p className="subtitle">Enter your access code to continue.</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
        />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
