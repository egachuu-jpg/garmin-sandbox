'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Brain, Battery, Moon, RefreshCw } from 'lucide-react';

type Dashboard = {
  readiness: number | null;
  hrv: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
  restingHr: number | null;
};

function readinessLabel(score: number | null): string {
  if (score === null) return 'No data yet';
  if (score >= 75) return 'Prime';
  if (score >= 50) return 'Ready';
  if (score >= 25) return 'Low';
  return 'Poor — recover';
}

export function ReadinessPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
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

  const score = data?.readiness ?? null;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)));

  return (
    <>
      {/* Readiness card */}
      <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-muted text-xs font-medium tracking-wide uppercase">Training Readiness</span>
          <button onClick={load} aria-label="Refresh" className="text-muted active:text-primary transition-colors">
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
          <div className="flex items-end gap-3 mt-3">
            <div className="text-5xl font-bold">{fmt(score)}</div>
            <p className="text-sm text-muted pb-1">{readinessLabel(score)}</p>
          </div>
        )}
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Brain, label: 'HRV', unit: 'ms', value: data?.hrv },
          { icon: Moon, label: 'Sleep', unit: 'score', value: data?.sleepScore },
          { icon: Battery, label: 'Battery', unit: '%', value: data?.bodyBattery },
        ].map(({ icon: Icon, label, unit, value }) => (
          <div key={label} className="bg-surface-card border border-surface-border rounded-xl p-3 text-center">
            <Icon size={16} className="text-muted mx-auto mb-1.5" />
            <p className="text-xs text-muted">{label}</p>
            <p className="text-xl font-semibold mt-0.5">
              {loading && !data ? <span className="inline-block h-5 w-8 rounded bg-surface-border animate-pulse align-middle" /> : fmt(value)}
            </p>
            <p className="text-xs text-muted">{unit}</p>
          </div>
        ))}
      </div>
    </>
  );
}
