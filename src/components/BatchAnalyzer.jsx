// /src/components/BatchAnalyzer.jsx
import React, { useState } from "react";

export default function BatchAnalyzer() {
  const [games, setGames] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setResults(null);

    let parsedGames = [];
    try {
      parsedGames = JSON.parse(games);
      if (!Array.isArray(parsedGames)) {
        throw new Error("Input must be a JSON array of games.");
      }
    } catch (err) {
      setError("Invalid input JSON. Please enter an array of games.");
      setLoading(false);
      return;
    }

    try {
      const resp = await fetch("/api/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: parsedGames }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`API error ${resp.status}: ${text}`);
      }

      const data = await resp.json();
      setResults(data);
    } catch (err) {
      console.error("[BatchAnalyzer] error", err);
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function loadExample() {
    const example = [
      {
        sport: "NBA",
        team: "Lakers",
        opponent: "Warriors",
        startTime: new Date().toISOString(),
      },
      {
        sport: "NBA",
        team: "Celtics",
        opponent: "Heat",
        startTime: new Date().toISOString(),
      },
    ];
    setGames(JSON.stringify(example, null, 2));
  }

  return (
    <div className="p-4 border rounded-md bg-white shadow-md">
      <h2 className="text-lg font-bold mb-2">Batch Analyzer</h2>
      <textarea
        className="w-full p-2 border rounded mb-2 font-mono"
        rows={8}
        placeholder='Enter JSON array of games (e.g. [{"sport":"NBA","team":"Lakers","opponent":"Warriors"}])'
        value={games}
        onChange={(e) => setGames(e.target.value)}
      />
      <div className="flex gap-2 mb-2">
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Analyze Batch"}
        </button>
        <button
          onClick={loadExample}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Load Example
        </button>
      </div>

      {error && (
        <div className="mt-2 text-red-600 font-semibold">Error: {error}</div>
      )}

      {results && (
        <div className="mt-4">
          <h3 className="font-semibold mb-2">
            Results ({results.count} analyzed)
          </h3>
          <pre className="bg-gray-100 p-2 rounded text-sm overflow-x-auto">
            {JSON.stringify(results.results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
