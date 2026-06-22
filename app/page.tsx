import Link from 'next/link';
import { Activity, Brain, Battery, Moon, ChevronRight } from 'lucide-react';
import { BottomNav } from '@/components/nav/BottomNav';

const PLAN_START = new Date('2026-06-22');
const RACE_DATE = new Date('2026-10-17');

function getCurrentWeek(): number {
  const now = new Date();
  const msPerWeek = 1000 * 60 * 60 * 24 * 7;
  const week = Math.floor((now.getTime() - PLAN_START.getTime()) / msPerWeek) + 1;
  return Math.max(1, Math.min(17, week));
}

function getDaysToRace(): number {
  const now = new Date();
  return Math.ceil((RACE_DATE.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const WEEK_1_WORKOUTS: Record<string, { title: string; detail: string }> = {
  Monday:    { title: '3 mi easy + SI Routine', detail: 'Target: 10:00–10:45/mi' },
  Tuesday:   { title: '3 mi easy + SI Routine', detail: 'Target: 10:00–10:45/mi' },
  Wednesday: { title: '30 min cycling',          detail: 'Low resistance, 85+ RPM' },
  Thursday:  { title: '2 mi easy shakeout',      detail: 'Target: 10:00–10:45/mi' },
  Friday:    { title: 'Complete Rest',            detail: 'Recovery & SI prep' },
  Saturday:  { title: '5 mi recovery long run',  detail: 'Target: 10:00–10:45/mi' },
  Sunday:    { title: 'Complete Rest',            detail: 'Full recovery' },
};

function getTodayWorkout() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName = days[new Date().getDay()];
  return { day: dayName, workout: WEEK_1_WORKOUTS[dayName] };
}

export default function HomePage() {
  const currentWeek = getCurrentWeek();
  const daysToRace = getDaysToRace();
  const { day, workout } = getTodayWorkout();

  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <p className="text-muted text-sm">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-2xl font-bold mt-0.5">Daily Readiness</h1>
      </div>

      <div className="px-4 space-y-4 mt-2">
        {/* Readiness — loads live data in Phase 2 */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-muted text-xs font-medium tracking-wide uppercase">Training Readiness</span>
            <Activity size={16} className="text-muted" />
          </div>
          <div className="flex items-end gap-3 mt-3">
            <div className="text-5xl font-bold text-muted">—</div>
            <p className="text-sm text-muted pb-1">Connect Garmin to see score</p>
          </div>
        </div>

        {/* Stat chips */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Brain,   label: 'HRV',     unit: 'ms' },
            { icon: Moon,    label: 'Sleep',    unit: 'score' },
            { icon: Battery, label: 'Battery',  unit: '%' },
          ].map(({ icon: Icon, label, unit }) => (
            <div
              key={label}
              className="bg-surface-card border border-surface-border rounded-xl p-3 text-center"
            >
              <Icon size={16} className="text-muted mx-auto mb-1.5" />
              <p className="text-xs text-muted">{label}</p>
              <p className="text-xl font-semibold mt-0.5">—</p>
              <p className="text-xs text-muted">{unit}</p>
            </div>
          ))}
        </div>

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
