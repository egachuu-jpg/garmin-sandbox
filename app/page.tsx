import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { BottomNav } from '@/components/nav/BottomNav';
import { getPlanContext } from '@/lib/training';
import { ReadinessPanel } from '@/components/home/ReadinessPanel';

// Date-sensitive — never statically cache a stale "today".
export const dynamic = 'force-dynamic';

const WEEK_1_WORKOUTS: Record<string, { title: string; detail: string }> = {
  Monday:    { title: '3 mi easy + SI Routine', detail: 'Target: 10:00–10:45/mi' },
  Tuesday:   { title: '3 mi easy + SI Routine', detail: 'Target: 10:00–10:45/mi' },
  Wednesday: { title: '30 min cycling',          detail: 'Low resistance, 85+ RPM' },
  Thursday:  { title: '2 mi easy shakeout',      detail: 'Target: 10:00–10:45/mi' },
  Friday:    { title: 'Complete Rest',            detail: 'Recovery & SI prep' },
  Saturday:  { title: '5 mi recovery long run',  detail: 'Target: 10:00–10:45/mi' },
  Sunday:    { title: 'Complete Rest',            detail: 'Full recovery' },
};

function getTodayWorkout(dayName: string) {
  return { day: dayName, workout: WEEK_1_WORKOUTS[dayName] };
}

export default function HomePage() {
  const { todayLabel, dayName, week: currentWeek, daysToRace } = getPlanContext();
  const { day, workout } = getTodayWorkout(dayName);

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
            Today · {day}
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

      <BottomNav />
    </div>
  );
}
