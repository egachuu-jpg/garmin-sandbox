import Link from 'next/link';
import { BottomNav } from '@/components/nav/BottomNav';

const PLAN_START = new Date('2026-06-22');
const RACE_DATE  = new Date('2026-10-17');

function getCurrentWeek(): number {
  const now = new Date();
  const msPerWeek = 1000 * 60 * 60 * 24 * 7;
  const w = Math.floor((now.getTime() - PLAN_START.getTime()) / msPerWeek) + 1;
  return Math.max(1, Math.min(17, w));
}

const PHASES = [
  { label: 'Base Build',              weeks: [1, 2, 3, 4],        color: 'text-blue-400',   tag: 'Phase 1' },
  { label: 'Aerobic Expansion',       weeks: [5, 6, 7, 8, 9, 10, 11], color: 'text-purple-400', tag: 'Phase 2' },
  { label: 'Peak Endurance',          weeks: [12, 13, 14],        color: 'text-orange-400', tag: 'Phase 3' },
  { label: 'Taper & Race',            weeks: [15, 16, 17],        color: 'text-primary',    tag: 'Phase 4' },
];

const WEEK_HIGHLIGHTS: Record<number, string> = {
  1:  '13 mi · Recovery base',
  2:  '19 mi · Easy miles',
  3:  '23 mi · First tempo',
  4:  '26 mi · Tempo build',
  5:  '29 mi · Intervals start',
  6:  '31 mi · 14 mi long',
  7:  '23 mi · Step-back week',
  8:  '34 mi · 16 mi long',
  9:  '34 mi · Tempo + 15 mi long',
  10: '26 mi · Step-back week',
  11: '38 mi · 18 mi long run',
  12: '34 mi · 14 mi long',
  13: '36 mi · 20 mi PEAK run',
  14: '28 mi · Transition block',
  15: '24 mi · Taper begins',
  16: '16 mi · Deep taper',
  17: 'Race week · Oct 17 🏁',
};

export default function PlanPage() {
  const currentWeek = getCurrentWeek();

  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <h1 className="text-2xl font-bold">Training Plan</h1>
        <p className="text-muted text-sm mt-1">Mankato Marathon · Oct 17, 2026</p>
      </div>

      <div className="px-4 mt-4 space-y-3">
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
          <p className="text-xs text-muted mt-1">Mankato Marathon · Sub-4:00 goal</p>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
