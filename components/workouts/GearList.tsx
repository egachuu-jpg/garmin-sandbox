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

type GarminGear = {
  uuid: string;
  name: string;
  type: string;
  miles: number;
  linked: boolean;
};

const inputClass =
  'w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary';

function AddGearSheet({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'garmin' | 'manual'>('garmin');

  // Garmin picker state
  const [garminGear, setGarminGear] = useState<GarminGear[] | null>(null);
  const [gearError, setGearError] = useState(false);
  const [selected, setSelected] = useState<GarminGear | null>(null);

  // Shared/manual fields
  const [alert, setAlert] = useState('400');
  const [notes, setNotes] = useState('');
  const [manual, setManual] = useState({ name: '', type: 'running_shoe', mileage_offset: '' });
  const [submitting, setSubmitting] = useState(false);

  function openSheet() {
    setOpen(true);
    setSelected(null);
    setGarminGear(null);
    setGearError(false);
    fetch('/api/gear/garmin')
      .then(r => r.json())
      .then(json => {
        if (json.error) setGearError(true);
        setGarminGear((json.gear as GarminGear[]) ?? []);
      })
      .catch(() => setGearError(true));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const payload =
      mode === 'garmin' && selected
        ? {
            name: selected.name,
            type: selected.type,
            garmin_gear_uuid: selected.uuid,
            mileage_offset: 0, // Garmin already tracks full mileage
            alert_threshold_miles: Number(alert) || 400,
            notes,
          }
        : {
            name: manual.name,
            type: manual.type,
            mileage_offset: Number(manual.mileage_offset) || 0,
            alert_threshold_miles: Number(alert) || 400,
            notes,
          };

    try {
      await fetch('/api/gear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setOpen(false);
      onAdd();
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = mode === 'garmin' ? !!selected : manual.name.trim().length > 0;

  return (
    <>
      <button
        onClick={openSheet}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary rounded-xl text-sm font-medium text-white"
      >
        <Plus size={16} />
        Add gear
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <form onSubmit={submit} className="relative w-full bg-surface-card rounded-t-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold">Add Gear</h2>

            {/* Mode toggle */}
            <div className="flex bg-surface rounded-xl p-1 border border-surface-border">
              {(['garmin', 'manual'] as const).map(m => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex-1 py-2 text-sm font-medium rounded-lg transition-colors',
                    mode === m ? 'bg-primary text-white' : 'text-muted'
                  )}
                >
                  {m === 'garmin' ? 'From Garmin' : 'Manual'}
                </button>
              ))}
            </div>

            {mode === 'garmin' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  Add the shoes in the Garmin Connect app first, then pick them here to track mileage automatically.
                </p>
                {garminGear === null && !gearError && (
                  <p className="text-sm text-muted py-4 text-center">Loading your Garmin gear…</p>
                )}
                {gearError && <p className="text-sm text-red-400 py-2">Couldn&apos;t reach Garmin. Try again or add manually.</p>}
                {garminGear?.length === 0 && !gearError && (
                  <p className="text-sm text-muted py-2">No active Garmin gear found. Add it in Garmin Connect first.</p>
                )}
                <div className="space-y-2">
                  {garminGear?.map(g => (
                    <button
                      type="button"
                      key={g.uuid}
                      disabled={g.linked}
                      onClick={() => setSelected(g)}
                      className={cn(
                        'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors',
                        g.linked
                          ? 'border-surface-border opacity-50 cursor-not-allowed'
                          : selected?.uuid === g.uuid
                          ? 'border-primary bg-primary/10'
                          : 'border-surface-border'
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{g.name}</p>
                        <p className="text-xs text-muted">{g.miles} mi on Garmin</p>
                      </div>
                      {g.linked && <span className="text-xs text-muted flex-shrink-0">Added</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <input
                  placeholder="Name (e.g. Nike Vomero 17)"
                  value={manual.name}
                  onChange={e => setManual(f => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                />
                <select
                  value={manual.type}
                  onChange={e => setManual(f => ({ ...f, type: e.target.value }))}
                  className={inputClass}
                >
                  <option value="running_shoe">Running Shoe</option>
                  <option value="trail_shoe">Trail Shoe</option>
                  <option value="road_bike">Road Bike</option>
                  <option value="other">Other</option>
                </select>
                <div>
                  <label className="text-xs text-muted mb-1 block">Starting miles</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={manual.mileage_offset}
                    onChange={e => setManual(f => ({ ...f, mileage_offset: e.target.value }))}
                    className={inputClass}
                  />
                  <p className="text-xs text-muted mt-1">Manual gear won&apos;t auto-update from Garmin.</p>
                </div>
              </div>
            )}

            {/* Shared fields */}
            <div>
              <label className="text-xs text-muted mb-1 block">Replace alert at (miles)</label>
              <input type="number" value={alert} onChange={e => setAlert(e.target.value)} className={inputClass} />
            </div>
            <textarea
              placeholder="Notes (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full bg-primary text-white rounded-xl py-3 font-semibold disabled:opacity-40"
            >
              {submitting ? 'Adding…' : 'Add Gear'}
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
