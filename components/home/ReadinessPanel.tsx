'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Brain, Battery, Moon, RefreshCw, ChevronDown } from 'lucide-react';

type Dashboard = {
  readiness: number | null;
  hrv: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
  restingHr: number | null;
};

type MetricKey = 'readiness' | 'hrv' | 'sleep' | 'battery';

const METRIC_LABELS: Record<MetricKey, string> = {
  readiness: 'Training Readiness',
  hrv: 'HRV',
  sleep: 'Sleep',
  battery: 'Body Battery',
};

function readinessLabel(score: number | null): string {
  if (score === null) return 'No data yet';
  if (score >= 75) return 'Prime';
  if (score >= 50) return 'Ready';
  if (score >= 25) return 'Low';
  return 'Poor — recover';
}

// Color scales match Garmin's banding so a 23 and a 95 read differently at a
// glance. HRV is deliberately uncolored — it's meaningful only relative to
// the athlete's own baseline, so an absolute color scale would mislead.
function readinessColor(score: number | null): string {
  if (score === null) return 'text-white';
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-yellow-400';
  if (score >= 25) return 'text-amber-500';
  return 'text-red-400';
}

function sleepColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return '';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  return 'text-red-400';
}

function batteryColor(level: number | null | undefined): string {
  if (level === null || level === undefined) return '';
  if (level >= 75) return 'text-emerald-400';
  if (level >= 50) return 'text-yellow-400';
  if (level >= 25) return 'text-amber-500';
  return 'text-red-400';
}

export function ReadinessPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Tapping a tile tells the story of that data point inline — no chat
  // navigation. Only one metric is expanded at a time; insights are cached
  // per metric per load so re-tapping doesn't re-fire the request.
  const [expanded, setExpanded] = useState<MetricKey | null>(null);
  const [insights, setInsights] = useState<Partial<Record<MetricKey, string>>>({});
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setExpanded(null);
    setInsights({});
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('bad status');
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fetchInsight = useCallback(
    async (metric: MetricKey) => {
      if (!data) return;
      setInsightLoading(true);
      setInsightError(false);
      try {
        const res = await fetch('/api/insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metric, dashboard: data }),
        });
        if (!res.ok) throw new Error('bad status');
        const json = await res.json();
        setInsights(prev => ({ ...prev, [metric]: json.insight ?? '' }));
      } catch {
        setInsightError(true);
      } finally {
        setInsightLoading(false);
      }
    },
    [data]
  );

  const toggleMetric = useCallback(
    (metric: MetricKey) => {
      if (!data) return;
      if (expanded === metric) {
        setExpanded(null);
        return;
      }
      setExpanded(metric);
      if (insights[metric] === undefined) fetchInsight(metric);
    },
    [data, expanded, insights, fetchInsight]
  );

  const score = data?.readiness ?? null;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)));

  const stats: Array<{ key: MetricKey; icon: typeof Brain; label: string; unit: string; value: number | null | undefined; color: string }> = [
    { key: 'hrv', icon: Brain, label: 'HRV', unit: 'ms', value: data?.hrv, color: '' },
    { key: 'sleep', icon: Moon, label: 'Sleep', unit: 'score', value: data?.sleepScore, color: sleepColor(data?.sleepScore) },
    { key: 'battery', icon: Battery, label: 'Battery', unit: '%', value: data?.bodyBattery, color: batteryColor(data?.bodyBattery) },
  ];

  return (
    <>
      {/* Readiness card */}
      <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-muted text-xs font-medium tracking-wide uppercase">Training Readiness</span>
          <button
            onClick={e => {
              e.stopPropagation();
              load();
            }}
            aria-label="Refresh"
            className="text-muted active:text-primary transition-colors"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error ? (
          <button onClick={load} className="flex items-end gap-3 mt-3 text-left">
            <Activity size={20} className="text-red-400 mb-1" />
            <p className="text-sm text-red-400 pb-1">Couldn&apos;t reach Garmin — tap to retry</p>
          </button>
        ) : loading && !data ? (
          <div className="flex items-end gap-3 mt-3">
            <div className="h-12 w-16 rounded-lg bg-surface-border animate-pulse" />
            <div className="h-4 w-24 rounded bg-surface-border animate-pulse mb-2" />
          </div>
        ) : (
          <button
            onClick={() => toggleMetric('readiness')}
            className="flex items-end gap-3 mt-3 w-full text-left active:opacity-70 transition-opacity"
          >
            <div className={`text-5xl font-bold ${readinessColor(score)}`}>{fmt(score)}</div>
            <p className="text-sm text-muted pb-1 flex-1">{readinessLabel(score)}</p>
            <ChevronDown
              size={16}
              className={`text-muted mb-2 transition-transform ${expanded === 'readiness' ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(({ key, icon: Icon, label, unit, value, color }) => (
          <button
            key={key}
            onClick={() => toggleMetric(key)}
            disabled={!data}
            className={`bg-surface-card border rounded-xl p-3 text-center transition-colors ${
              expanded === key ? 'border-primary' : 'border-surface-border'
            }`}
          >
            <Icon size={16} className="text-muted mx-auto mb-1.5" />
            <p className="text-xs text-muted">{label}</p>
            <p className={`text-xl font-semibold mt-0.5 ${color}`}>
              {loading && !data ? (
                <span className="inline-block h-5 w-8 rounded bg-surface-border animate-pulse align-middle" />
              ) : (
                fmt(value)
              )}
            </p>
            <p className="text-xs text-muted">{unit}</p>
          </button>
        ))}
      </div>

      {/* "Tell the story" panel — expands inline under the tiles, never
          navigates to chat. */}
      {expanded && (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-primary">{METRIC_LABELS[expanded]}</span>
            <button onClick={() => setExpanded(null)} className="text-muted text-xs active:text-primary transition-colors">
              Close
            </button>
          </div>
          {insightLoading ? (
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-surface-border animate-pulse" />
              <div className="h-3 w-5/6 rounded bg-surface-border animate-pulse" />
              <div className="h-3 w-3/4 rounded bg-surface-border animate-pulse" />
            </div>
          ) : insightError ? (
            <button onClick={() => fetchInsight(expanded)} className="text-sm text-red-400">
              Couldn&apos;t generate an insight — tap to retry
            </button>
          ) : (
            <p className="text-sm text-gray-300 leading-relaxed">{insights[expanded]}</p>
          )}
        </div>
      )}
    </>
  );
}
