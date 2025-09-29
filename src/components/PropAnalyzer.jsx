import React, { useState } from 'react';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import ResultCard from './ResultCard';

export default function PropAnalyzer() {
  const [form, setForm] = useState({
    sport: 'NBA',
    player: '',
    opponent: '',
    prop: '',
    oddsOver: '-110',
    oddsUnder: '-110',
    startTimeLocal: ''
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
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

    const analysisData = {
      sport: (form.sport || '').trim(),
      player: (form.player || '').trim(),
      opponent: (form.opponent || '').trim(),
      prop: (form.prop || '').trim(),
      odds: {
        over: parseFloat(form.oddsOver),
        under: parseFloat(form.oddsUnder),
      },
      currentPrice: parseFloat(form.oddsOver), // Use over odds as current price for CLV
      startTime: toISOFromLocal(form.startTimeLocal),
    };

    try {
      const response = await axios.post('/api/analyze-prop', analysisData);
      console.log('[UI] /api/analyze-prop', response.status, response.data);
      setResult(response.data);
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

  const handleFeedback = async (outcome) => {
    try {
      const payload = {
        player: form.player,
        prop: form.prop,
        outcome,
        note,
      };
      const r = await axios.post('/api/feedback', payload);
      if (r?.data?.ok) setFeedbackMsg(`Saved: ${outcome} ✅`);
      else setFeedbackMsg(`Saved (no-disk) ✅`);
      setNote('');
      setTimeout(() => setFeedbackMsg(''), 3000);
    } catch (err) {
      console.error('feedback failed', err);
      setFeedbackMsg('Failed to save ❌');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h2 className="text-2xl font-semibold">Player Prop Analyzer</h2>

      <form onSubmit={handleAnalyze} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sport */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Sport</span>
          <select
            name="sport"
            value={form.sport}
            onChange={handleChange}
            className="border rounded p-2"
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
            className="border rounded p-2"
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
            className="border rounded p-2"
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
            className="border rounded p-2"
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
            className="border rounded p-2"
            required
          />
        </label>

        {/* Odds Over (American format) */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Over (American odds)</span>
          <input
            type="text"
            name="oddsOver"
            value={form.oddsOver}
            onChange={handleChange}
            placeholder="-110, +120, etc."
            className="border rounded p-2"
          />
          <span className="text-xs text-gray-500 mt-1">
            American format: -110, +150, etc.
          </span>
        </label>

        {/* Odds Under (American format) */}
        <label className="flex flex-col">
          <span className="text-sm font-medium mb-1">Under (American odds)</span>
          <input
            type="text"
            name="oddsUnder"
            value={form.oddsUnder}
            onChange={handleChange}
            placeholder="-110, +120, etc."
            className="border rounded p-2"
          />
          <span className="text-xs text-gray-500 mt-1">
            American format: -110, +150, etc.
          </span>
        </label>

        {/* Analyze Button */}
        <div className="md:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            className="bg-black text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-60"
            disabled={loading}
          >
            Analyze Prop
          </button>
          {loading && <LoadingSpinner />}
        </div>
      </form>

      {/* Feedback buttons */}
      <div className="space-y-2 border-t pt-4">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Notes about why it hit/didn't hit (variance, injuries, etc.)"
          className="w-full p-2 bg-gray-50 border rounded text-sm"
          rows={3}
        />
        <div className="flex gap-3">
          <button
            onClick={() => handleFeedback("hit")}
            className="bg-green-600 text-white px-4 py-2 rounded hover:opacity-90"
          >
            Hit
          </button>
          <button
            onClick={() => handleFeedback("miss")}
            className="bg-red-600 text-white px-4 py-2 rounded hover:opacity-90"
          >
            Didn't Hit
          </button>
          {feedbackMsg && <span className="text-sm text-gray-600">{feedbackMsg}</span>}
        </div>
      </div>

      {error && (
        <div className="text-red-600 text-sm border border-red-200 rounded p-3 bg-red-50">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <ResultCard result={result} type="prop" />
          <div className="border rounded p-4">
            <div className="font-semibold mb-2">Analysis Result (raw)</div>
            <pre className="text-xs overflow-auto">{JSON.stringify(result, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
