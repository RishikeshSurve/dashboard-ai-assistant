import { useState } from "react";
import { fetchSchema } from "../api";

const DATE_EXAMPLES = [
  "last 30 days",
  "this year",
  "year to date",
  "Jan 2026",
  "from 2025-01-01 to 2025-03-31",
];

const COMPARISON_EXAMPLES: { label: string; hint: string }[] = [
  {
    label: "vs previous period",
    hint: "Compares to the stretch of time right before your range -- the previous calendar month for a full/partial month, or the same number of days immediately prior otherwise. Good for \"are we trending up or down right now.\"",
  },
  {
    label: "year over year",
    hint: "Compares to the exact same calendar dates one year earlier. Good for spotting real change while ignoring seasonal patterns (e.g. holiday spikes that repeat every year).",
  },
];

const GROUPING_EXAMPLES = ["by platform", "by campaign", "trend over time (daily)", "top 5 campaigns by revenue", "biggest gainers"];

/** Right-side panel with example prompt phrasing, always visible, plus a contextual callout
 *  when the last query came back empty or errored -- helps people self-correct an inaccurate
 *  prompt instead of guessing why nothing showed up. */
export default function TipsPanel({
  onSuggest,
  lastEmpty,
  lastError,
}: {
  onSuggest: (prompt: string) => void;
  lastEmpty?: boolean;
  lastError?: string | null;
}) {
  const [schema, setSchema] = useState<string | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);

  async function handleViewSchema() {
    if (schema) {
      setSchema(null);
      return;
    }
    setLoadingSchema(true);
    try {
      setSchema(await fetchSchema());
    } catch {
      setSchema("Couldn't load the schema right now.");
    } finally {
      setLoadingSchema(false);
    }
  }

  return (
    <aside className="tips-panel">
      <h3>Prompt tips</h3>
      <p className="tips-intro">Click any example to try it, or work a phrase like this into your own question.</p>

      <div className="tips-section">
        <h4>Date ranges</h4>
        <ul className="tips-list">
          {DATE_EXAMPLES.map((ex) => (
            <li key={ex}>
              <button type="button" onClick={() => onSuggest(`spend by platform ${ex}`)}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tips-section">
        <h4>Comparisons</h4>
        <ul className="tips-list">
          {COMPARISON_EXAMPLES.map((ex) => (
            <li key={ex.label}>
              <button type="button" title={ex.hint} onClick={() => onSuggest(`total spend and revenue this month ${ex.label}`)}>
                {ex.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tips-section">
        <h4>Grouping</h4>
        <ul className="tips-list">
          {GROUPING_EXAMPLES.map((ex) => (
            <li key={ex}>
              <button type="button" onClick={() => onSuggest(`spend and conversions ${ex}, last 30 days`)}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tips-section">
        <h4>Not sure what's queryable?</h4>
        <ul className="tips-list">
          <li>
            <button type="button" onClick={handleViewSchema} disabled={loadingSchema}>
              {loadingSchema ? "Loading..." : schema ? "Hide available data" : "View available data & metrics"}
            </button>
          </li>
        </ul>
        {schema && <pre className="tips-schema">{schema}</pre>}
      </div>

      {(lastEmpty || lastError) && (
        <div className="tips-callout">
          {lastError ? (
            <>That last request hit an error. Try simplifying it, or double-check the date range and metric names.</>
          ) : (
            <>
              No rows came back for that one. A few things to try: be explicit about the date range (e.g. "Jan
              2026" or "from 2026-01-01 to 2026-01-31"), confirm the platform name matches Facebook, Google Ads,
              Reddit, Quora, or PulsePoint exactly, or use "View available data & metrics" above to see exactly
              what's queryable.
            </>
          )}
        </div>
      )}
    </aside>
  );
}
