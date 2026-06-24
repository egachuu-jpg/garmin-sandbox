'use client';

import { useState } from 'react';
import { BottomNav } from '@/components/nav/BottomNav';
import { GearList } from '@/components/workouts/GearList';
import { ScheduledWorkouts } from '@/components/workouts/ScheduledWorkouts';

export default function WorkoutsPage() {
  const [tab, setTab] = useState<'scheduled' | 'gear'>('scheduled');

  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <h1 className="text-2xl font-bold">Workouts</h1>
      </div>

      {/* Segmented control */}
      <div className="px-4 mt-2 mb-4">
        <div className="flex bg-surface-card rounded-xl p-1 border border-surface-border">
          {(['scheduled', 'gear'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
                tab === t ? 'bg-primary text-white' : 'text-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4">
        {tab === 'scheduled' ? <ScheduledWorkouts /> : <GearList />}
      </div>

      <BottomNav />
    </div>
  );
}
