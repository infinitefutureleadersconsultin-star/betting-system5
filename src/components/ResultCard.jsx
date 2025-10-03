import React from "react";

function pct(x) {
  if (x == null || Number.isNaN(Number(x))) return "-";
  return `${Math.round(Number(x) * 1000) / 10}%`;
}

function formatOdds(odds, format = 'american') {
  if (!Number.isFinite(Number(odds))) return "-";
  const num = Number(odds);
  
  if (format === 'decimal') {
    if (num > 0) return ((num / 100) + 1).toFixed(2);
    return ((100 / Math.abs(num)) + 1).toFixed(2);
  }
  
  return num > 0 ? `+${num}` : String(num);
}

// Convert technical result into human-readable paragraph
function generateAnalysisParagraph(result) {
  const confidence = result.finalConfidence || result.confidence || 0;
  const decision = result.decision || result.recommendation || "";
  const player = result.player || "";
  const prop = result.prop || "";
  
  // Confidence level description
  let confidenceLevel = "";
  if (confidence >= 70) confidenceLevel = "very high confidence";
  else if (confidence >= 60) confidenceLevel = "solid confidence";
  else confidenceLevel = "moderate confidence";
  
  // Decision context
  let recommendation = "";
  if (decision.includes("OVER")) {
    recommendation = `We recommend betting the OVER on this prop`;
  } else if (decision.includes("UNDER")) {
    recommendation = `We recommend betting the UNDER on this prop`;
  } else if (decision.includes("LOCK")) {
    recommendation = `This is a LOCK play - our highest conviction level`;
  } else if (decision.includes("STRONG")) {
    recommendation = `This is a STRONG LEAN - high conviction play`;
  } else if (decision.includes("LEAN")) {
    recommendation = `This is a LEAN play`;
  } else {
    recommendation = `We suggest passing on this prop`;
  }
  
  // Sample size context
  const sampleSize = result.rawNumbers?.sampleSize || 0;
  let dataQuality = "";
  if (sampleSize >= 8) {
    dataQuality = `based on strong recent data (${sampleSize} games)`;
  } else if (sampleSize >= 5) {
    dataQuality = `based on recent data (${sampleSize} games)`;
  } else if (sampleSize > 0) {
    dataQuality = `based on limited recent data (${sampleSize} games)`;
  } else {
    dataQuality = `based on season averages`;
  }
  
  // CLV context
  let clvContext = "";
  if (result.clv && result.clv.favorability === "favorable") {
    clvContext = ` This line has moved in our favor since opening, providing positive closing line value.`;
  } else if (result.clv && result.clv.favorability === "unfavorable") {
    clvContext = ` Note that the line has moved against us since opening.`;
  }
  
  return `${recommendation} with ${confidenceLevel} (${confidence}%). Our analysis ${dataQuality} shows ${player}'s ${prop} performance justifies this prediction.${clvContext}`;
}

export default function ResultCard({ result, type, oddsFormat = 'american' }) {
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

  return (
    <div className="space-y-6">
      {/* Main Decision Card */}
      <div className={`p-6 border-2 rounded-lg ${decisionColor(result.decision || result.recommendation)}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-2xl font-bold">{type === "prop" ? result.player : result.game}</h3>
          <span className="text-3xl font-bold">{result.decision || result.recommendation}</span>
        </div>

        <div className="text-xl mb-4">
          <span className="text-gray-300">{type === "prop" ? result.prop : result.line}</span>
          {result.suggestion && <span className="ml-2 font-semibold">{result.suggestion}</span>}
        </div>

        <div className="flex items-center justify-between mb-4">
          <span className={`text-2xl font-bold ${confColor(result.finalConfidence ?? result.confidence ?? 0)}`}>
            {(result.finalConfidence ?? result.confidence ?? 0)}% Confidence
          </span>
          {result.suggestedStake != null && (
            <span className="text-lg text-gray-300">Stake: {result.suggestedStake}%</span>
          )}
        </div>

        {/* Human-Readable Analysis */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <h4 className="text-sm font-semibold text-betting-green mb-2">Analysis Summary</h4>
          <p className="text-gray-300 leading-relaxed">
            {generateAnalysisParagraph(result)}
          </p>
        </div>
      </div>

      {/* CLV Card */}
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
          </div>
        </div>
      )}

      {/* Top Drivers */}
      {Array.isArray(result.topDrivers) && result.topDrivers.length > 0 && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-semibold mb-3 text-betting-green">Key Factors</h4>
          <ul className="space-y-1">
            {result.topDrivers.map((d, i) => (
              <li key={i} className="text-sm text-gray-300">
                • {d}
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
    </div>
  );
}
