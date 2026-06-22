'use client';

import { useState, useEffect } from 'react';
import { Plus, AlertTriangle, Footprints } from 'lucide-react';
import { cn } from '@/lib/utils';

type GearItem = {
  id: string;
  name: string;
  type: string;
  total_miles: number;
  alert_threshold_miles: number;
  alert_pct: number;
  notes: string | null;
  retired: boolean;
};

function ProgressBar({ pct }: { pct: number }) {
  const color =
    pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-primary';
  return (
    <div className="h-1.5 bg-surface-border rounded-full overflow-hidden mt-2">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function AddGearSheet({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'running_shoe',
    mileage_offset: '',
    alert_threshold_miles: '400',
    notes: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/gear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        mileage_offset: Number(form.mileage_offset) || 0,
        alert_threshold_miles: Number(form.alert_threshold_miles) || 400,
      }),
    });
    setOpen(false);
    onAdd();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary rounded-xl text-sm font-medium text-white"
      >
        <Plus size={16} />
        Add gear
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <form
            onSubmit={submit}
            className="relative w-full bg-surface-card rounded-t-2xl p-6 space-y-4"
          >
            <h2 className="text-lg font-bold mb-2">Add Gear</h2>
            <p className="text-xs text-muted -mt-2">Register gear in Garmin Connect first, then add it here to configure alerts.</p>

            <input
              required
              placeholder="Name (e.g. Nike Vomero 17)"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
            />

            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
            >
              <option value="running_shoe">Running Shoe</option>
              <option value="trail_shoe">Trail Shoe</option>
              <option value="road_bike">Road Bike</option>
              <option value="other">Other</option>
            </select>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Starting miles</label>
                <input
                  type="number"
                  placeholder="0"
                  value={form.mileage_offset}
                  onChange={e => setForm(f => ({ ...f, mileage_offset: e.target.value }))}
                  className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Alert at (miles)</label>
                <input
                  type="number"
                  value={form.alert_threshold_miles}
                  onChange={e => setForm(f => ({ ...f, alert_threshold_miles: e.target.value }))}
                  className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <textarea
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary resize-none"
            />

            <button
              type="submit"
              className="w-full bg-primary text-white rounded-xl py-3 font-semibold"
            >
              Add Gear
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function GearList() {
  const [gear, setGear] = useState<GearItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/gear');
    if (res.ok) setGear(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted text-sm">
        Loading gear…
      </div>
    );
  }

  return (
    <div>
      {gear.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <Footprints size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No gear tracked yet</p>
          <p className="text-xs mt-1 mb-6">Add your running shoes to track mileage and get replacement alerts</p>
          <AddGearSheet onAdd={load} />
        </div>
      ) : (
        <div className="space-y-3">
          {gear.map(item => (
            <div
              key={item.id}
              className="bg-surface-card border border-surface-border rounded-2xl p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted mt-0.5 capitalize">{item.type.replace('_', ' ')}</p>
                </div>
                {item.alert_pct >= 80 && (
                  <AlertTriangle
                    size={18}
                    className={item.alert_pct >= 100 ? 'text-red-400' : 'text-yellow-400'}
                  />
                )}
              </div>

              <ProgressBar pct={item.alert_pct} />

              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-medium">{item.total_miles} mi</span>
                <span className="text-xs text-muted">
                  {item.alert_pct >= 100
                    ? 'Replace now'
                    : `${item.alert_threshold_miles - item.total_miles} mi remaining`}
                </span>
              </div>

              {item.notes && (
                <p className="text-xs text-muted mt-2 border-t border-surface-border pt-2">
                  {item.notes}
                </p>
              )}
            </div>
          ))}

          <div className="flex justify-center pt-2">
            <AddGearSheet onAdd={load} />
          </div>
        </div>
      )}
    </div>
  );
}
