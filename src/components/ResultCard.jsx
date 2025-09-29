import React, { useState } from "react";
import axios from "axios";

function pct(x) {
  if (x == null || Number.isNaN(Number(x))) return "-";
  return `${Math.round(Number(x) * 1000) / 10}%`; // one decimal, e.g. 57.8%
}

function formatOdds(odds) {
  if (!Number.isFinite(Number(odds))) return "-";
  const num = Number(odds);
  return num > 0 ? `+${num}` : String(num);
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
        <p className="text-red-200">{result.message || "An error occurred during analysis"}</p>
      </div>
    );
  }

  const decisionColor = (d) => {
    const dStr = String(d || "").toUpperCase();
    if (dStr.includes("LOCK")) return "text-betting-green border-betting-green bg-green-900/20";
    if (dStr.includes("STRONG")) return "text-betting-yellow border-betting-yellow bg-yellow-900/20";
    if (dStr.includes("LEAN") || dStr.includes("BET")) return "text-blue-400 border-blue-400 bg-blue-900/20";
    if (dStr.includes("OVER") || dStr.includes("UNDER")) return "text-purple-400 border-purple-400 bg-purple-900/20";
    return "text-gray-400 border-gray-600 bg-gray-900/20";
  };

  const confColor = (c) => (c >= 70 ? "text-betting-green" : c >= 60 ? "text-betting-yellow" : "text-gray-400");

  const clvColor = (favorability) => {
    if (favorability === "favorable") return "text-green-400";
    if (favorability === "unfavorable") return "text-red-400";
    return "text-gray-400";
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
      {/* Main Decision Card */}
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

      {/* CLV Card (NEW) */}
      {result.clv && (
        <div className={`p-4 border rounded-lg ${
          result.clv.favorability === "favorable" 
            ? "bg-green-900/20 border-green-600" 
            : result.clv.favorability === "unfavorable"
            ? "bg-red-900/20 border-red-600"
            : "bg-gray-800 border-gray-600"
        }`}>
          <h4 className="font-semibold mb-3 text-white">Closing Line Value (CLV)</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">CLV Percent:</span>
              <span className={`ml-2 font-mono font-bold ${clvColor(result.clv.favorability)}`}>
                {result.clv.percent > 0 ? '+' : ''}{result.clv.percent}%
              </span>
            </div>
            <div>
              <span className="text-gray-400">Favorability:</span>
              <span className={`ml-2 font-semibold capitalize ${clvColor(result.clv.favorability)}`}>
                {result.clv.favorability}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Line Movement:</span>
              <span className="ml-2 font-mono">
                {result.clv.lineDiff > 0 ? '+' : ''}{result.clv.lineDiff}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Direction:</span>
              <span className="ml-2 capitalize">{result.clv.direction}</span>
            </div>
            {result.clv.openingImpliedProb && (
              <div>
                <span className="text-gray-400">Opening Prob:</span>
                <span className="ml-2 font-mono">{pct(result.clv.openingImpliedProb)}</span>
              </div>
            )}
            {result.clv.currentImpliedProb && (
              <div>
                <span className="text-gray-400">Current Prob:</span>
                <span className="ml-2 font-mono">{pct(result.clv.currentImpliedProb)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Opening Odds Card (NEW) */}
      {result.oddsData && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-betting-green">Opening Odds Data</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Opening Line:</span>
              <span className="ml-2 font-mono font-bold">{result.oddsData.openingLine}</span>
            </div>
            <div>
              <span className="text-gray-400">Opening Price:</span>
              <span className="ml-2 font-mono">{formatOdds(result.oddsData.openingPrice)}</span>
            </div>
            <div>
              <span className="text-gray-400">Source:</span>
              <span className="ml-2 font-semibold">{result.oddsData.source}</span>
            </div>
            <div>
              <span className="text-gray-400">Timestamp:</span>
              <span className="ml-2 text-xs">
                {new Date(result.oddsData.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Top Drivers */}
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

      {/* Flags */}
      {Array.isArray(result.flags) && result.flags.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-600 p-4 rounded-lg">
          <h4 className="font-semibold mb-2 text-yellow-400">Flags</h4>
          <div className="flex flex-wrap gap-2">
            {result.flags.map((f, i) => {
              const isPositive = f.includes("positive_clv");
              const isNegative = f.includes("negative_clv");
              const badgeColor = isPositive 
                ? "bg-green-600 text-green-100" 
                : isNegative 
                ? "bg-red-600 text-red-100" 
                : "bg-yellow-600 text-yellow-100";
              
              return (
                <span key={i} className={`px-2 py-1 rounded text-xs ${badgeColor}`}>
                  {f}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Raw Analytics */}
      {result.rawNumbers && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-betting-green">Raw Analytics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {Object.entries(result.rawNumbers).map(([k, v]) => {
              // Skip odds fields (handled separately above)
              if (k === "openingOdds" || k === "closingOdds" || 
                  k === "openingOddsFallback" || k === "openingOddsFromSDIO") {
                return null;
              }
              
              const lower = typeof v === "number" && v >= 0 && v <= 1;
              return (
                <div key={k}>
                  <span className="text-gray-400 capitalize">
                    {k.replace(/([A-Z])/g, ' $1').trim()}:
                  </span>
                  <span className="ml-2 font-mono">
                    {lower ? pct(v) : (typeof v === 'number' ? v.toFixed(3) : String(v))}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Feedback Buttons */}
          <div className="mt-4 flex gap-2">
            <button
              className="bg-green-700 px-3 py-1 rounded hover:bg-green-600"
              onClick={() => { 
                setFeedbackOutcome("hit"); 
                setFeedbackOpen(f => !f); 
              }}
            >
              {feedbackOpen && feedbackOutcome === "hit" ? "Cancel" : "Hit"}
            </button>
            <button
              className="bg-red-700 px-3 py-1 rounded hover:bg-red-600"
              onClick={() => { 
                setFeedbackOutcome("miss"); 
                setFeedbackOpen(f => !f); 
              }}
            >
              {feedbackOpen && feedbackOutcome === "miss" ? "Cancel" : "Didn't Hit"}
            </button>
            {submitMsg && <div className="text-sm text-green-400">{submitMsg}</div>}
          </div>

          {/* Feedback Form */}
          {feedbackOpen && (
            <div className="mt-3 space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What happened? (optional notes)"
                className="w-full p-2 bg-gray-900 border rounded text-sm"
                rows={4}
              />
              <div className="flex gap-2">
                <button
                  disabled={submitting}
                  onClick={handleFeedbackSubmit}
                  className="bg-green-600 px-3 py-1 rounded hover:bg-green-500 disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Feedback"}
                </button>
                <button
                  onClick={() => { 
                    setFeedbackOpen(false); 
                    setNote(""); 
                    setFeedbackOutcome(null); 
                  }}
                  className="bg-gray-600 px-3 py-1 rounded hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Meta Information */}
      {result.meta && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-gray-400">Meta Information</h4>
          <div className="text-xs space-y-1">
            {result.meta.matchedName && (
              <div><span className="text-gray-500">Matched Name:</span> {result.meta.matchedName}</div>
            )}
            {result.meta.dataSource && (
              <div><span className="text-gray-500">Data Source:</span> {result.meta.dataSource}</div>
            )}
            {result.meta.zeroFiltered !== undefined && (
              <div><span className="text-gray-500">Zero-Filtered Games:</span> {result.meta.zeroFiltered}</div>
            )}
            {Array.isArray(result.meta.usedEndpoints) && result.meta.usedEndpoints.length > 0 && (
              <div>
                <span className="text-gray-500">Used Endpoints:</span>
                <div className="ml-2 text-gray-400">{result.meta.usedEndpoints.join(", ")}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
