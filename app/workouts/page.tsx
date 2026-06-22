'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Dumbbell, Footprints, Plus, AlertTriangle } from 'lucide-react';
import { BottomNav } from '@/components/nav/BottomNav';
import { GearList } from '@/components/workouts/GearList';

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
        {tab === 'scheduled' ? (
          <div>
            <div className="text-center py-12 text-muted">
              <Dumbbell size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No workouts scheduled yet</p>
              <p className="text-xs mt-1 mb-6">Ask coach to build and schedule one</p>
              <Link
                href="/chat?prompt=Schedule%20this%20week's%20workouts%20from%20my%20training%20plan%20on%20my%20Garmin%20calendar"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary rounded-xl text-sm font-medium text-white"
              >
                <Plus size={16} />
                Ask coach to schedule
              </Link>
            </div>
          </div>
        ) : (
          <GearList />
        )}
      </div>

      <BottomNav />
    </div>
  );
}
