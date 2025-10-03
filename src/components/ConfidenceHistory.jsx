import React, { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import axios from 'axios';

export default function ConfidenceHistory() {
  const { user } = useUser();
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ total: 0, highConfidence: 0, record: '0-0' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!user) return;

      try {
        // Fetch user's query history (stored based on confidence scores, not outcomes)
        const response = await axios.get(`/api/user/confidence-history`);
        
        if (response.data?.history) {
          setHistory(response.data.history);
          calculateStats(response.data.history);
        }
      } catch (err) {
        console.error('Failed to fetch history:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [user]);

  const calculateStats = (historyData) => {
    const total = historyData.length;
    const highConf = historyData.filter(h => h.confidence >= 70).length;
    
    // Calculate record based on confidence > 50 = "predicted win"
    const wins = historyData.filter(h => h.confidence >= 50).length;
    const losses = total - wins;
    
    setStats({
      total,
      highConfidence: highConf,
      record: `${wins}-${losses}`
    });
  };

  if (loading) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-2xl font-bold text-betting-green mb-4">Your Confidence History</h2>
        <p className="text-gray-300 mb-6">
          Track your high-confidence picks to see how our model performs on your queries. 
          This shows which confidence levels are most reliable for your betting style.
        </p>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-900/50 p-4 rounded text-center">
            <div className="text-3xl font-bold text-white">{stats.total}</div>
            <div className="text-sm text-gray-400">Total Queries</div>
          </div>
          <div className="bg-gray-900/50 p-4 rounded text-center">
            <div className="text-3xl font-bold text-betting-green">{stats.highConfidence}</div>
            <div className="text-sm text-gray-400">High Confidence (70%+)</div>
          </div>
          <div className="bg-gray-900/50 p-4 rounded text-center">
            <div className="text-3xl font-bold text-blue-400">{stats.record}</div>
            <div className="text-sm text-gray-400">Predicted Record</div>
          </div>
        </div>
      </div>

      {/* History List */}
      <div className="space-y-3">
        {history.length === 0 ? (
          <div className="bg-gray-800 p-8 rounded-lg text-center border border-gray-700">
            <p className="text-gray-400">No queries yet. Start analyzing props to build your history!</p>
          </div>
        ) : (
          history.map((item, i) => (
            <div key={i} className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-betting-green transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">{item.player} - {item.prop}</div>
                  <div className="text-sm text-gray-400">{item.sport} • {new Date(item.timestamp).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${
                    item.confidence >= 70 ? 'text-betting-green' : 
                    item.confidence >= 60 ? 'text-betting-yellow' : 
                    'text-gray-400'
                  }`}>
                    {item.confidence}%
                  </div>
                  <div className="text-sm text-gray-400">{item.decision}</div>
                </div>
              </div>

              {item.clv && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="text-xs text-gray-500">
                    CLV: <span className={item.clv.favorability === 'favorable' ? 'text-green-400' : 'text-red-400'}>
                      {item.clv.percent > 0 ? '+' : ''}{item.clv.percent}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Confidence Breakdown */}
      {history.length > 0 && (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-xl font-bold mb-4">Confidence Level Breakdown</h3>
          <div className="space-y-3">
            {[
              { label: 'LOCK (70%+)', min: 70, color: 'bg-betting-green' },
              { label: 'STRONG LEAN (67-69%)', min: 67, max: 69, color: 'bg-betting-yellow' },
              { label: 'LEAN (65-66%)', min: 65, max: 66, color: 'bg-blue-400' },
              { label: 'LOW (<65%)', max: 64, color: 'bg-gray-500' }
            ].map(tier => {
              const count = history.filter(h => {
                if (tier.max) return h.confidence >= (tier.min || 0) && h.confidence <= tier.max;
                return h.confidence >= tier.min;
              }).length;
              
              const percentage = history.length > 0 ? Math.round((count / history.length) * 100) : 0;
              
              return (
                <div key={tier.label} className="flex items-center gap-3">
                  <div className="w-40 text-sm text-gray-400">{tier.label}</div>
                  <div className="flex-1 bg-gray-700 rounded-full h-6 overflow-hidden">
                    <div 
                      className={`h-full ${tier.color} flex items-center justify-center text-xs font-bold`}
                      style={{ width: `${percentage}%` }}
                    >
                      {percentage > 10 && `${count} (${percentage}%)`}
                    </div>
                  </div>
                  {percentage <= 10 && <span className="text-xs text-gray-400 w-16">{count} ({percentage}%)</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
