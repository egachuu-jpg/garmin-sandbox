'use client';

import { useState } from 'react';
import { GearList } from '@/components/workouts/GearList';
import { ScheduledWorkouts } from '@/components/workouts/ScheduledWorkouts';
import { PlanOverview } from './PlanOverview';

export type TrainingTab = 'schedule' | 'plan' | 'gear';

const TABS: Array<{ key: TrainingTab; label: string }> = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'plan', label: 'Plan' },
  { key: 'gear', label: 'Gear' },
];

export function TrainingTabs({ initialTab }: { initialTab: TrainingTab }) {
  const [tab, setTab] = useState<TrainingTab>(initialTab);

  return (
    <>
      <div className="px-4 mt-2 mb-4">
        <div className="flex bg-surface-card rounded-xl p-1 border border-surface-border">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                tab === t.key ? 'bg-primary text-white' : 'text-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4">
        {tab === 'schedule' ? <ScheduledWorkouts /> : tab === 'plan' ? <PlanOverview /> : <GearList />}
      </div>
    </>
  );
}
