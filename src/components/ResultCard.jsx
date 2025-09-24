import { useState } from "react";
import axios from "axios";

export default function ResultCard({ result, type }) {
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!result) return null;

  // --- Error card handling ---
  if (result.decision === "ERROR") {
    return (
      <div className="p-4 bg-red-900 border border-red-700 rounded-md">
        <h3 className="text-lg font-semibold text-red-300 mb-2">
          Analysis Error
        </h3>
        <p className="text-red-200">{result.message}</p>
        {Array.isArray(result.errors) && result.errors.length > 0 && (
          <ul className="mt-2 text-sm text-red-300">
            {result.errors.map((e, i) => (
              <li key={i}>• {e}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // --- Color helpers ---
  const decisionColor = (d) => {
    switch (d) {
      case "LOCK":
        return "text-betting-green border-betting-green bg-green-900/20";
      case "STRONG_LEAN":
        return "text-betting-yellow border-betting-yellow bg-yellow-900/20";
      case "LEAN":
        return "text-blue-400 border-blue-400 bg-blue-900/20";
      case "BET":
        return "text-betting-green border-betting-green bg-green-900/20";
      default:
        return "text-gray-400 border-gray-600 bg-gray-900/20";
    }
  };

  const confColor = (c) =>
    c >= 70
      ? "text-betting-green"
      : c >= 60
      ? "text-betting-yellow"
      : "text-gray-400";

  // --- Feedback submit handler ---
  const handleFeedback = async (hit) => {
    try {
      await axios.post("/api/feedback", {
        player: result.player || result.game,
        prop: result.prop || result.line,
        decision: result.decision || result.recommendation,
        confidence: result.finalConfidence ?? result.confidence,
        suggestion: result.suggestion || null,
        hit, // true = hit, false = didn’t hit
        notes,
        timestamp: new Date().toISOString(),
      });
      setSubmitted(true);
    } catch (err) {
      console.error("[ResultCard] feedback failed", err);
      alert("Failed to submit feedback.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Decision Card */}
      <div
        className={`p-4 border rounded-lg ${
          decisionColor(result.decision || result.recommendation)
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold">
            {type === "prop" ? result.player : result.game}
          </h3>
          <span className="text-2xl font-bold">
            {result.decision || result.recommendation}
          </span>
        </div>

        <div className="text-lg mb-2">
          <span className="text-gray-300">
            {type === "prop" ? result.prop : result.line}
          </span>
          {result.suggestion && (
            <span className="ml-2 font-semibold">{result.suggestion}</span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span
            className={`text-lg font-semibold ${confColor(
              result.finalConfidence ?? result.confidence ?? 0
            )}`}
          >
            {(result.finalConfidence ?? result.confidence ?? 0)}% Confidence
          </span>
          {result.suggestedStake != null && (
            <span className="text-sm text-gray-300">
              Stake: {result.suggestedStake}% bankroll
            </span>
          )}
        </div>
      </div>

      {/* Drivers */}
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
            {result.flags.map((f, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-yellow-600 text-yellow-100 rounded text-xs"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Raw Analytics */}
      {result.rawNumbers && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-betting-green">
            Raw Analytics
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {Object.entries(result.rawNumbers).map(([k, v]) => (
              <div key={k}>
                <span className="text-gray-400 capitalize">
                  {k.replace(/([A-Z])/g, " $1").trim()}:
                </span>
                <span className="ml-2 font-mono">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- Feedback Section --- */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
        <h4 className="font-semibold mb-2 text-betting-yellow">
          Outcome Feedback
        </h4>

        {submitted ? (
          <div className="text-green-400 text-sm">
            ✅ Feedback submitted. Thanks!
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes (e.g., Chris Sale only pitched 4 innings)"
              className="w-full border rounded p-2 text-sm bg-gray-800 text-gray-200"
            />
            <div className="flex gap-3">
              <button
                onClick={() => handleFeedback(true)}
                className="px-3 py-1 rounded bg-green-700 text-white text-sm hover:bg-green-600"
              >
                Hit
              </button>
              <button
                onClick={() => handleFeedback(false)}
                className="px-3 py-1 rounded bg-red-700 text-white text-sm hover:bg-red-600"
              >
                Didn’t Hit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
