import React, { useState } from "react";
import axios from "axios";

function pct(x) {
  if (x == null || Number.isNaN(Number(x))) return "-";
  return `${Math.round(Number(x) * 1000) / 10}%`; // one decimal, e.g. 57.8%
}

export default function ResultCard({ result, type }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  const [feedbackOutcome, setFeedbackOutcome] = useState(null);

  if (!result) return null;

  if (result.decision === "ERROR") {
    return (
      <div className="p-4 bg-red-900 border border-red-700 rounded-md">
        <h3 className="text-lg font-semibold text-red-300 mb-2">Analysis Error</h3>
        <p className="text-red-200">{result.message}</p>
      </div>
    );
  }

  const decisionColor = (d) => {
    switch (d) {
      case "LOCK": return "text-betting-green border-betting-green bg-green-900/20";
      case "STRONG_LEAN": return "text-betting-yellow border-betting-yellow bg-yellow-900/20";
      case "LEAN": return "text-blue-400 border-blue-400 bg-blue-900/20";
      case "BET": return "text-betting-green border-betting-green bg-green-900/20";
      default: return "text-gray-400 border-gray-600 bg-gray-900/20";
    }
  };

  const confColor = (c) => (c >= 70 ? "text-betting-green" : c >= 60 ? "text-betting-yellow" : "text-gray-400");

  // helper to render opening/closing odds cleanly
  const renderOdds = (raw) => {
    if (!raw) return "-";
    if (raw.over !== undefined || raw.under !== undefined) {
      const ov = raw.over !== undefined && Number.isFinite(Number(raw.over)) ? Number(raw.over).toFixed(2) : "-";
      const ud = raw.under !== undefined && Number.isFinite(Number(raw.under)) ? Number(raw.under).toFixed(2) : "-";
      return <div>{`Over: ${ov}  Under: ${ud}`}</div>;
    }
    if (raw.home !== undefined || raw.away !== undefined) {
      const h = raw.home !== undefined && Number.isFinite(Number(raw.home)) ? Number(raw.home).toFixed(2) : "-";
      const a = raw.away !== undefined && Number.isFinite(Number(raw.away)) ? Number(raw.away).toFixed(2) : "-";
      return <div>{`Home: ${h}  Away: ${a}`}</div>;
    }
    try {
      return <pre className="text-xs">{JSON.stringify(raw)}</pre>;
    } catch {
      return String(raw);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackOutcome) return;
    setSubmitting(true);
    setSubmitMsg("");
    try {
      const payload = {
        note,
        outcome: feedbackOutcome,
        actualOutcome: result.actualOutcome || null,
        result
      };
      const r = await axios.post("/api/feedback", payload);
      if (r?.data?.ok) setSubmitMsg("Saved feedback ✅");
      else setSubmitMsg("Saved (no-disk) ✅");
      setNote("");
      setFeedbackOpen(false);
    } catch (err) {
      setSubmitMsg("Failed to save feedback");
      console.error("feedback failed", err);
    } finally {
      setSubmitting(false);
      setTimeout(() => setSubmitMsg(""), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className={`p-4 border rounded-lg ${decisionColor(result.decision || result.recommendation)}`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold">{type === "prop" ? result.player : result.game}</h3>
          <span className="text-2xl font-bold">{result.decision || result.recommendation}</span>
        </div>

        <div className="text-lg mb-2">
          <span className="text-gray-300">{type === "prop" ? result.prop : result.line}</span>
          {result.suggestion && <span className="ml-2 font-semibold">{result.suggestion}</span>}
        </div>

        <div className="flex items-center justify-between">
          <span className={`text-lg font-semibold ${confColor(result.finalConfidence ?? result.confidence ?? 0)}`}>
            {(result.finalConfidence ?? result.confidence ?? 0)}% Confidence
          </span>
          {result.suggestedStake != null && (
            <span className="text-sm text-gray-300">Stake: {result.suggestedStake}% bankroll</span>
          )}
        </div>
      </div>

      {Array.isArray(result.topDrivers) && result.topDrivers.length > 0 && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-betting-green">Top Drivers</h4>
          <ul className="space-y-1">
            {result.topDrivers.map((d, i) => (
              <li key={i} className="text-sm text-gray-300">
                {i + 1}. {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(result.flags) && result.flags.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-600 p-4 rounded-lg">
          <h4 className="font-semibold mb-2 text-yellow-400">Flags</h4>
          <div className="flex flex-wrap gap-2">
            {result.flags.map((f, i) => (
              <span key={i} className="px-2 py-1 bg-yellow-600 text-yellow-100 rounded text-xs">{f}</span>
            ))}
          </div>
        </div>
      )}

      {result.rawNumbers && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-betting-green">Raw Analytics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {Object.entries(result.rawNumbers).map(([k, v]) => {
              if (k === "openingOdds" || k === "closingOdds" || k === "openingOddsFallback" || k === "openingOddsFromSDIO") return null;
              const lower = typeof v === "number" && v >= 0 && v <= 1;
              return (
                <div key={k}>
                  <span className="text-gray-400 capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}:</span>
                  <span className="ml-2 font-mono">{lower ? pct(v) : (typeof v === 'number' ? v : String(v))}</span>
                </div>
              );
            })}

            <div>
              <span className="text-gray-400">Opening Odds:</span>
              <div className="ml-2 font-mono">{renderOdds(result.rawNumbers.openingOdds)}</div>
              {result.rawNumbers.impliedOpeningProb !== undefined && (
                <div className="text-xs text-gray-400 mt-1">Implied: {pct(result.rawNumbers.impliedOpeningProb)}</div>
              )}
            </div>

            <div>
              <span className="text-gray-400">Closing Odds:</span>
              <div className="ml-2 font-mono">{renderOdds(result.rawNumbers.closingOdds)}</div>
            </div>

            {result.rawNumbers.openingOddsFromSDIO && (
              <div className="md:col-span-2">
                <span className="text-gray-400">SDIO Odds (raw):</span>
                <pre className="text-xs overflow-auto">{JSON.stringify(result.rawNumbers.openingOddsFromSDIO, null, 2)}</pre>
              </div>
            )}
            {result.rawNumbers.openingOddsFallback && (
              <div className="md:col-span-2">
                <span className="text-gray-400">OddsAPI Fallback (raw):</span>
                <pre className="text-xs overflow-auto">{JSON.stringify(result.rawNumbers.openingOddsFallback, null, 2)}</pre>
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              className="bg-green-700 px-3 py-1 rounded"
              onClick={() => { setFeedbackOutcome("hit"); setFeedbackOpen(f => !f); }}
            >
              {feedbackOpen && feedbackOutcome === "hit" ? "Cancel" : "Hit"}
            </button>
            <button
              className="bg-red-700 px-3 py-1 rounded"
              onClick={() => { setFeedbackOutcome("miss"); setFeedbackOpen(f => !f); }}
            >
              {feedbackOpen && feedbackOutcome === "miss" ? "Cancel" : "Didn't Hit"}
            </button>
            {submitMsg && <div className="text-sm text-green-400">{submitMsg}</div>}
          </div>

          {feedbackOpen && (
            <div className="mt-3 space-y-2">
              <textarea
                value={note}
                onChange={(e)=>setNote(e.target.value)}
                placeholder="What happened? (optional notes)"
                className="w-full p-2 bg-gray-900 border rounded text-sm"
                rows={4}
              />
              <div className="flex gap-2">
                <button
                  disabled={submitting}
                  onClick={handleFeedbackSubmit}
                  className="bg-green-600 px-3 py-1 rounded"
                >
                  {submitting ? "Saving..." : "Save Feedback"}
                </button>
                <button
                  onClick={()=>{ setFeedbackOpen(false); setNote(""); setFeedbackOutcome(null); }}
                  className="bg-gray-600 px-3 py-1 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
