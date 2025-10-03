import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import LoadingSpinner from './LoadingSpinner';
import ResultCard from './ResultCard';

const decimalToAmerican = (decimal) => {
  const dec = Number(decimal);
  if (!Number.isFinite(dec) || dec <= 1) return -110;
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
};

const americanToDecimal = (american) => {
  const am = Number(american);
  if (!Number.isFinite(am) || am === 0) return 2.0;
  if (am > 0) return (am / 100) + 1;
  return (100 / Math.abs(am)) + 1;
};

export default function PropAnalyzer() {
  const { getToken } = useAuth();
  const [oddsFormat, setOddsFormat] = useState('decimal');
  const [form, setForm] = useState({
    sport: 'NBA',
    player: '',
    opponent: '',
    prop: '',
    oddsOver: '2.0',
    oddsUnder: '2.0',
    startTimeLocal: ''
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [signalsRemaining, setSignalsRemaining] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleOddsFormatChange = (newFormat) => {
    if (oddsFormat === 'decimal' && newFormat === 'american') {
      setForm((prev) => ({
        ...prev,
        oddsOver: String(decimalToAmerican(prev.oddsOver)),
        oddsUnder: String(decimalToAmerican(prev.oddsUnder))
      }));
    } else if (oddsFormat === 'american' && newFormat === 'decimal') {
      setForm((prev) => ({
        ...prev,
        oddsOver: String(americanToDecimal(prev.oddsOver).toFixed(2)),
        oddsUnder: String(americanToDecimal(prev.oddsUnder).toFixed(2))
      }));
    }
    setOddsFormat(newFormat);
  };

  const toISOFromLocal = (local) => {
    try {
      if (!local) return '';
      const d = new Date(local);
      if (isNaN(d)) return '';
      return d.toISOString();
    } catch {
      return '';
    }
  };

  const handleAnalyze = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    let overAmerican, underAmerican;
    if (oddsFormat === 'decimal') {
      overAmerican = decimalToAmerican(form.oddsOver);
      underAmerican = decimalToAmerican(form.oddsUnder);
    } else {
      overAmerican = parseFloat(form.oddsOver);
      underAmerican = parseFloat(form.oddsUnder);
    }

    const analysisData = {
      sport: (form.sport || '').trim(),
      player: (form.player || '').trim(),
      prop: (form.prop || '').trim(),
      startTime: toISOFromLocal(form.startTimeLocal),
      currentPrice: overAmerican,
    };

    try {
      const token = await getToken();
      const response = await axios.post('/api/props/evaluate', analysisData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('[UI] /api/props/evaluate', response.status, response.data);
      setResult(response.data.result);
      
      // Update signals remaining from response
      if (response.data.user) {
        setSignalsRemaining(response.data.user.queriesRemaining);
      }
    } catch (err) {
      console.error('[UI] analyze-prop failed', err);
      setError(
        err?.response?.data?.error ||
        err?.message ||
        'Analysis failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Player Prop Analyzer</h2>
        
        <div className="flex items-center gap-4">
          {/* Signals Counter */}
          {signalsRemaining !== null && (
            <div className="bg-gray-800 px-4 py-2 rounded-lg border border-betting-green">
              <span className="text-sm text-gray-400">Signals Remaining:</span>
              <span className="ml-2 text-xl font-bold text-betting-green">{signalsRemaining}</span>
            </div>
          )}
          
          {/* Odds Format Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded p-1">
            <button
              type="button"
              onClick={() => handleOddsFormatChange('decimal')}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                oddsFormat === 'decimal'
                  ? 'bg-black text-white'
                  : 'bg-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Decimal
            </button>
            <button
              type="button"
              onClick={() => handleOddsFormatChange('american')}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                oddsFormat === 'american'
                  ? 'bg-black text-white'
                  : 'bg-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              American
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleAnalyze} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sport */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Sport</span>
          <select
            name="sport"
            value={form.sport}
            onChange={handleChange}
            className="border rounded p-2 bg-gray-800 text-white"
          >
            <option>NBA</option>
            <option>WNBA</option>
            <option>MLB</option>
            <option>NFL</option>
          </select>
        </label>

        {/* Start Time */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Start Time (local)</span>
          <input
            type="datetime-local"
            name="startTimeLocal"
            value={form.startTimeLocal}
            onChange={handleChange}
            className="border rounded p-2 bg-gray-800 text-white"
          />
        </label>

        {/* Player */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Player</span>
          <input
            type="text"
            name="player"
            value={form.player}
            onChange={handleChange}
            placeholder="e.g., Nikola Jokic"
            className="border rounded p-2 bg-gray-800 text-white"
            required
          />
        </label>

        {/* Opponent */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Opponent</span>
          <input
            type="text"
            name="opponent"
            value={form.opponent}
            onChange={handleChange}
            placeholder="e.g., Lakers"
            className="border rounded p-2 bg-gray-800 text-white"
          />
        </label>

        {/* Prop */}
        <label className="flex flex-col md:col-span-2">
          <span className="text-sm font-medium mb-1">Prop</span>
          <input
            type="text"
            name="prop"
            value={form.prop}
            onChange={handleChange}
            placeholder='e.g., "Points 23.5", "Assists 8.5", "Strikeouts 6.5"'
            className="border rounded p-2 bg-gray-800 text-white"
            required
          />
        </label>

        {/* Odds Over */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">
            Over ({oddsFormat === 'decimal' ? 'decimal' : 'American'})
          </span>
          <input
            type="text"
            name="oddsOver"
            value={form.oddsOver}
            onChange={handleChange}
            placeholder={oddsFormat === 'decimal' ? '2.0, 1.85, etc.' : '-110, +120, etc.'}
            className="border rounded p-2 bg-gray-800 text-white"
          />
        </label>

        {/* Odds Under */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">
            Under ({oddsFormat === 'decimal' ? 'decimal' : 'American'})
          </span>
          <input
            type="text"
            name="oddsUnder"
            value={form.oddsUnder}
            onChange={handleChange}
            placeholder={oddsFormat === 'decimal' ? '2.0, 1.85, etc.' : '-110, +120, etc.'}
            className="border rounded p-2 bg-gray-800 text-white"
          />
        </label>

        {/* Analyze Button */}
        <div className="md:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            className="bg-betting-green text-white px-6 py-3 rounded hover:opacity-90 disabled:opacity-60"
            disabled={loading}
          >
            Analyze Prop
          </button>
          {loading && <LoadingSpinner />}
        </div>
      </form>

      {error && (
        <div className="text-red-600 text-sm border border-red-200 rounded p-3 bg-red-50">
          {error}
        </div>
      )}

      {result && (
        <ResultCard result={result} type="prop" oddsFormat={oddsFormat} />
      )}
    </div>
  );
}
