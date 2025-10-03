import React from 'react';

export default function EducationSection() {
  const articles = [
    {
      title: "Understanding Closing Line Value (CLV)",
      content: "CLV measures whether you're betting at better prices than the market closes at. Consistently beating the closing line is the #1 indicator of long-term profitability.",
      category: "Strategy"
    },
    {
      title: "Why Market Probability Matters",
      content: "The betting market is incredibly efficient. Our model combines statistical analysis with market wisdom to find edges where bookmakers misprice props.",
      category: "Analytics"
    },
    {
      title: "Bankroll Management 101",
      content: "Never bet more than 1-3% of your bankroll on a single play. Our confidence scores help you size bets appropriately - higher confidence = larger stake.",
      category: "Money Management"
    },
    {
      title: "Reading Confidence Scores",
      content: "70%+ = LOCK (highest conviction). 67-69% = STRONG LEAN. 65-66% = LEAN. Below 65% = PASS. These thresholds are calibrated to long-term win rates.",
      category: "Strategy"
    },
    {
      title: "Why We Track Opening Odds",
      content: "Line movement reveals sharp money. When lines move in our favor after opening, it validates our analysis and adds positive CLV to your bets.",
      category: "Advanced"
    }
  ];

  const tips = [
    "Bet the opening line when possible - it typically offers the best value before sharp action moves it",
    "Track your high-confidence plays separately - these should be your most profitable long-term",
    "Don't chase losses. Variance is normal. Trust the process over large sample sizes (100+ bets)",
    "Use our confidence scores for bet sizing: 70%+ confidence = 3% bankroll, 67-69% = 2%, 65-66% = 1%"
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-2xl font-bold text-betting-green mb-4">Betting Education & Strategy</h2>
        <p className="text-gray-300 mb-6">
          Understanding how to use our analytics effectively is just as important as the analytics themselves. 
          Here's what you need to know to maximize your edge.
        </p>
      </div>

      {/* Articles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {articles.map((article, i) => (
          <div key={i} className="bg-gray-800 p-5 rounded-lg border border-gray-700 hover:border-betting-green transition-colors">
            <div className="text-xs text-betting-green font-semibold mb-2">{article.category}</div>
            <h3 className="text-lg font-bold mb-3">{article.title}</h3>
            <p className="text-gray-400 text-sm leading-relaxed">{article.content}</p>
          </div>
        ))}
      </div>

      {/* Daily Tips */}
      <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 p-6 rounded-lg border border-betting-green">
        <h3 className="text-xl font-bold text-betting-green mb-4">Daily Betting Tips</h3>
        <div className="space-y-3">
          {tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-betting-green font-bold text-lg">•</span>
              <p className="text-gray-300">{tip}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Market Movement Analysis */}
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h3 className="text-xl font-bold mb-4">Today's Market Movement Insights</h3>
        <div className="space-y-4">
          <div className="border-l-4 border-green-500 pl-4">
            <div className="font-semibold text-green-400">Sharp Money Indicator</div>
            <p className="text-gray-400 text-sm mt-1">
              Heavy betting on Lakers -5 moved the line to -6.5. Sharp bettors took early Lakers value.
            </p>
          </div>
          <div className="border-l-4 border-yellow-500 pl-4">
            <div className="font-semibold text-yellow-400">Public Fade Opportunity</div>
            <p className="text-gray-400 text-sm mt-1">
              80% of public bets on Warriors ML, but line hasn't moved. Books expecting Warriors to lose.
            </p>
          </div>
          <div className="border-l-4 border-blue-500 pl-4">
            <div className="font-semibold text-blue-400">Reverse Line Movement</div>
            <p className="text-gray-400 text-sm mt-1">
              Celtics spread moved from -4 to -3 despite 65% of bets on Celtics. Classic sharp money indicator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
