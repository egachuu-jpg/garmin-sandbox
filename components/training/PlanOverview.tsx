import Link from 'next/link';
import { getPlanContext } from '@/lib/training';

const PHASES = [
  { label: 'Base Build',        weeks: [1, 2, 3, 4],            color: 'text-blue-400',   tag: 'Phase 1' },
  { label: 'Aerobic Expansion', weeks: [5, 6, 7, 8, 9, 10, 11], color: 'text-purple-400', tag: 'Phase 2' },
  { label: 'Peak Endurance',    weeks: [12, 13, 14],            color: 'text-orange-400', tag: 'Phase 3' },
  { label: 'Taper & Race',      weeks: [15, 16, 17],            color: 'text-primary',    tag: 'Phase 4' },
];

// Weekly totals from mankato-marathon-training-plan.md (July 2026 revision).
const WEEK_HIGHLIGHTS: Record<number, string> = {
  1:  '13 mi · Recovery base',
  2:  '19 mi · Easy miles',
  3:  '23 mi · First MGP tempo + strength',
  4:  '26 mi · Tempo build',
  5:  '29 mi · Intervals start',
  6:  '31 mi · 14 mi long',
  7:  '23 mi · Step-back week',
  8:  '36 mi · 15 mi long + fueling practice',
  9:  '38 mi · 16 mi long, MGP finish',
  10: '27 mi · Step-back week',
  11: '41 mi · Peak: 18 mi long, MGP finish',
  12: '35 mi · 14 mi long',
  13: '38 mi · 20 mi PEAK rehearsal',
  14: '≈26 mi · Half-marathon tune-up',
  15: '24 mi · Taper begins',
  16: '17 mi · Deep taper',
  17: 'Race week · Oct 17 🏁',
};

export function PlanOverview() {
  // Same Chicago-pinned week math as the rest of the app (the old Plan page
  // had its own server-local calculation that could disagree around week
  // boundaries).
  const currentWeek = getPlanContext().week;

  return (
    <div className="space-y-3 pb-2">
      <p className="text-muted text-sm">Mankato Marathon · Oct 17, 2026</p>

      {/* Current week callout */}
      <div className="bg-primary/10 border border-primary/30 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wide">Current</p>
          <p className="text-xl font-bold mt-0.5">Week {currentWeek} of 17</p>
          <p className="text-sm text-muted mt-0.5">{WEEK_HIGHLIGHTS[currentWeek]}</p>
        </div>
        <Link
          href={`/chat?prompt=${encodeURIComponent(`What's on the plan for Week ${currentWeek}? Walk me through each day's workout.`)}`}
          className="text-sm text-primary font-medium px-3 py-2 border border-primary/40 rounded-xl"
        >
          Details →
        </Link>
      </div>

      {/* Phase blocks */}
      {PHASES.map(phase => (
        <div
          key={phase.tag}
          className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
            <div>
              <span className={`text-xs font-medium ${phase.color}`}>{phase.tag}</span>
              <p className="text-sm font-semibold mt-0.5">{phase.label}</p>
            </div>
            <span className="text-xs text-muted">
              Weeks {phase.weeks[0]}–{phase.weeks[phase.weeks.length - 1]}
            </span>
          </div>

          <div className="divide-y divide-surface-border">
            {phase.weeks.map(w => (
              <div
                key={w}
                className={`flex items-center px-4 py-2.5 gap-3 ${
                  w === currentWeek ? 'bg-primary/5' : ''
                }`}
              >
                <span
                  className={`text-xs font-bold w-14 ${
                    w === currentWeek ? 'text-primary' : 'text-muted'
                  }`}
                >
                  Wk {w}
                  {w === currentWeek && ' ◀'}
                </span>
                <span className="text-xs text-gray-400 flex-1">{WEEK_HIGHLIGHTS[w]}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Race day */}
      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 text-center">
        <p className="text-2xl mb-1">🏁</p>
        <p className="font-bold">Race Day</p>
        <p className="text-muted text-sm">Saturday, October 17, 2026</p>
        <p className="text-xs text-muted mt-1">Mankato Marathon · A-goal 3:50 · defend sub-4:00</p>
      </div>
    </div>
  );
}
