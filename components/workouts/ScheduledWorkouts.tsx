'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Dumbbell, Plus, Check, Moon, Flag, RefreshCw } from 'lucide-react';

type Workout = {
  date: string | null;
  name: string | null;
  sport: string | null;
  completed: boolean;
  workoutType: string | null;
  isRestDay: boolean;
  isRaceDay: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  // iso is a calendar date (YYYY-MM-DD); render without timezone shifting.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDistance(m: number | null): string | null {
  if (!m) return null;
  return `${(m / 1609.34).toFixed(1)} mi`;
}

function fmtDuration(s: number | null): string | null {
  if (!s) return null;
  return `${Math.round(s / 60)} min`;
}

export function ScheduledWorkouts() {
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/workouts');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setWorkouts(json.workouts as Workout[]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !workouts) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-16 rounded-2xl bg-surface-card border border-surface-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted">
        <p className="text-sm text-red-400 mb-3">Couldn&apos;t load scheduled workouts</p>
        <button onClick={load} className="text-sm text-primary font-medium">
          Retry
        </button>
      </div>
    );
  }

  if (!workouts || workouts.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <Dumbbell size={36} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No workouts scheduled yet</p>
        <p className="text-xs mt-1 mb-6">Ask coach to build and schedule one</p>
        <Link
          href="/chat?new=1&prompt=Schedule%20this%20week's%20workouts%20from%20my%20training%20plan%20on%20my%20Garmin%20calendar"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary rounded-xl text-sm font-medium text-white"
        >
          <Plus size={16} />
          Ask coach to schedule
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 pb-2">
      <div className="flex justify-end">
        <button onClick={load} aria-label="Refresh" className="text-muted active:text-primary transition-colors p-1">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {workouts.map((w, i) => {
        const meta = [fmtDistance(w.distanceMeters), fmtDuration(w.durationSeconds), w.sport]
          .filter(Boolean)
          .join(' · ');
        return (
          <div
            key={`${w.date}-${i}`}
            className="flex items-center gap-3 bg-surface-card border border-surface-border rounded-2xl p-4"
          >
            <div className="w-12 flex-shrink-0 text-center">
              <p className="text-[11px] text-muted uppercase tracking-wide">{fmtDate(w.date)}</p>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">
                {w.isRestDay && <Moon size={13} className="text-muted flex-shrink-0" />}
                {w.isRaceDay && <Flag size={13} className="text-primary flex-shrink-0" />}
                {w.name || (w.isRestDay ? 'Rest day' : 'Workout')}
              </p>
              {meta && <p className="text-xs text-muted mt-0.5 truncate">{meta}</p>}
            </div>
            {w.completed && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs text-emerald-400">
                <Check size={14} /> Done
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
