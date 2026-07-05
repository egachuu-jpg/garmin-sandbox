import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getPlanContext } from '@/lib/training';
import { getDayWorkout } from '@/lib/plan-schedule';
import { ReadinessPanel } from '@/components/home/ReadinessPanel';

// Date-sensitive — never statically cache a stale "today".
export const dynamic = 'force-dynamic';

export default function HomePage() {
  const { todayLabel, dayName, week: currentWeek, daysToRace } = getPlanContext();
  const workout = getDayWorkout(currentWeek, dayName);

  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <p className="text-muted text-sm">{todayLabel}</p>
        <h1 className="text-2xl font-bold mt-0.5">Daily Readiness</h1>
      </div>

      <div className="px-4 space-y-4 mt-2">
        {/* Live readiness + HRV/sleep/battery from Garmin (cached client-side) */}
        <ReadinessPanel />

        {/* Today's workout */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <p className="text-muted text-xs font-medium uppercase tracking-wide mb-3">
            Today · {dayName} · Week {currentWeek}
          </p>
          <p className="text-base font-semibold">{workout.title}</p>
          <p className="text-sm text-muted mt-1">{workout.detail}</p>
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-surface-border">
            <span className="text-xs text-muted">Week {currentWeek} of 17</span>
            <span className="text-xs text-muted">·</span>
            <span className="text-xs text-muted">{daysToRace} days to race</span>
          </div>
        </div>

        {/* Coach callout */}
        <Link
          href="/chat"
          className="flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-2xl p-4 active:bg-primary/20 transition-colors"
        >
          <div className="flex-1">
            <p className="text-xs text-primary font-medium mb-1 uppercase tracking-wide">Coach</p>
            <p className="text-sm text-gray-200">
              Week {currentWeek} of Mankato training — tap to chat about today's plan or check your stats.
            </p>
          </div>
          <ChevronRight size={18} className="text-primary flex-shrink-0" />
        </Link>
      </div>
    </div>
  );
}
