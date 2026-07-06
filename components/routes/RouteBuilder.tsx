'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wind, MapPin, Locate, Trash2, Undo2, RotateCcw, Pencil, Save, Sparkles, X } from 'lucide-react';
import { RouteMap, type MapLine, type MapPoint } from './RouteMap';
import { BottomSheet, type SheetSnap } from './BottomSheet';

const MI = 1609.34;
const CAND_COLORS = ['#10b981', '#3b82f6', '#f59e0b'];

type SavedPlace = { id: string; name: string; lat: number; lng: number; is_default: boolean };

type Workout = {
  date: string | null;
  name: string | null;
  sport: string | null;
  completed: boolean;
  isRestDay: boolean;
  distanceMeters: number | null;
};

type Candidate = {
  name: string;
  geojson: { type: 'LineString'; coordinates: number[][] };
  waypoints: MapPoint[];
  distanceMeters: number;
  ascentMeters: number;
  explanation: string;
};

type WindInfo = {
  speedMph: number;
  gustMph: number;
  directionLabel: string;
};

type SuggestResponse = { wind: WindInfo | null; windy: boolean; candidates: Candidate[] };

type SavedRoute = {
  id: string;
  name: string;
  sport: 'running' | 'cycling';
  workout_date: string | null;
  distance_meters: number;
  ascent_meters: number | null;
  geojson: { type: 'LineString'; coordinates: number[][] };
  waypoints: MapPoint[] | null;
  source: 'suggested' | 'manual';
};

type Sport = 'running' | 'cycling';
type Prefs = {
  surface: 'trails' | 'roads' | 'mixed';
  elevation: 'flat' | 'hilly' | 'any';
  shape: 'loop' | 'out_and_back';
  avoidBusyRoads: boolean;
};

function detectSport(w: Workout): Sport | null {
  const s = `${w.sport ?? ''} ${w.name ?? ''}`.toLowerCase();
  if (/(cycl|bike|ride)/.test(s)) return 'cycling';
  if (/run/.test(s)) return 'running';
  return null;
}

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function fmtWorkoutDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const miles = (m: number) => `${(m / MI).toFixed(1)} mi`;
const feet = (m: number | null) => (m == null ? null : `${Math.round(m * 3.281)} ft`);

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active ? 'bg-primary border-primary text-white' : 'bg-surface-card border-surface-border text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function WindCard({ wind, windy, date }: { wind: WindInfo | null; windy: boolean; date: string }) {
  return (
    <div className="flex items-center gap-3 bg-surface-card border border-surface-border rounded-2xl p-3">
      <Wind size={18} className={windy ? 'text-amber-400' : 'text-muted'} />
      <div className="text-xs">
        {wind ? (
          <>
            <span className="font-medium">
              {wind.speedMph} mph from the {wind.directionLabel}
            </span>
            <span className="text-muted"> · gusts {wind.gustMph} mph · {fmtWorkoutDate(date)}</span>
            {windy && <p className="text-amber-400 mt-0.5">Windy — routes are shaped for shelter and tailwind finishes.</p>}
          </>
        ) : (
          <span className="text-muted">No wind forecast yet for {fmtWorkoutDate(date)} (forecasts cover ~16 days out).</span>
        )}
      </div>
    </div>
  );
}

export default function RouteBuilder() {
  const [mode, setMode] = useState<'suggest' | 'draw' | 'saved'>('suggest');

  // Full-height map with the controls in a draggable bottom sheet. The sheet
  // drops to 'peek' whenever the user needs the map (drawing, dropping pins)
  // and rises to 'half' when there's something to read or type.
  const [snap, setSnap] = useState<SheetSnap>('half');
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaH, setAreaH] = useState(0);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setAreaH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start point
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [startPlaceId, setStartPlaceId] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState<MapPoint | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);
  const [pendingPin, setPendingPin] = useState<MapPoint | null>(null);
  const [placeName, setPlaceName] = useState('');

  // Suggest
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [selWorkoutIdx, setSelWorkoutIdx] = useState<number | null>(null);
  const [sport, setSport] = useState<Sport>('running');
  const [distanceMi, setDistanceMi] = useState('5.0');
  const [date, setDate] = useState(chicagoToday());
  const [prefs, setPrefs] = useState<Prefs>({ surface: 'mixed', elevation: 'any', shape: 'loop', avoidBusyRoads: true });
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [result, setResult] = useState<SuggestResponse | null>(null);
  const [selCand, setSelCand] = useState(0);
  // After generating, collapse the request form to a one-line summary so the
  // map + candidates fit on screen without scrolling past all the controls.
  const [formCollapsed, setFormCollapsed] = useState(false);

  // Draw / edit
  const [waypoints, setWaypoints] = useState<MapPoint[]>([]);
  const [snapped, setSnapped] = useState<{ geojson: SavedRoute['geojson']; distanceMeters: number; ascentMeters: number } | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [snapError, setSnapError] = useState('');
  const skipSnapRef = useRef(false);

  // Saved
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [selSavedId, setSelSavedId] = useState<string | null>(null);
  // Two-step delete: first tap arms, second tap deletes.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Save-name dialog: startSave() stashes the route body and opens the sheet;
  // confirmSave() posts it under whatever name the user settled on.
  const [saveName, setSaveName] = useState<string | null>(null);
  const pendingBodyRef = useRef<Record<string, unknown> | null>(null);

  const [fitKey, setFitKey] = useState(0);
  const bumpFit = () => setFitKey(k => k + 1);

  const defaultPlace = places.find(p => p.is_default) ?? places[0] ?? null;
  const startPlace = places.find(p => p.id === startPlaceId) ?? defaultPlace;
  const startPoint: MapPoint | null = customStart ?? (startPlace ? { lat: startPlace.lat, lng: startPlace.lng } : null);
  const center = startPoint ?? { lat: 44.95, lng: -93.27 }; // Twin Cities fallback until a place is saved

  const loadPlaces = useCallback(async () => {
    try {
      const res = await fetch('/api/places');
      const json = await res.json();
      setPlaces(json.places ?? []);
    } catch {
      /* map still works without places */
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/routes');
      const json = await res.json();
      setSavedRoutes(json.routes ?? []);
    } catch {
      /* list stays empty */
    }
  }, []);

  useEffect(() => {
    loadPlaces();
    loadSaved();
    fetch('/api/workouts')
      .then(r => r.json())
      .then(json => setWorkouts(((json.workouts ?? []) as Workout[]).filter(w => w.date && !w.isRestDay && !w.completed && detectSport(w))))
      .catch(() => {});
  }, [loadPlaces, loadSaved]);

  // Snap waypoints to paths (debounced) while drawing.
  useEffect(() => {
    if (mode !== 'draw') return;
    if (waypoints.length < 2) {
      setSnapped(null);
      return;
    }
    if (skipSnapRef.current) {
      skipSnapRef.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setSnapping(true);
      setSnapError('');
      try {
        const res = await fetch('/api/routes/directions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sport, waypoints, surface: prefs.surface, avoidBusyRoads: prefs.avoidBusyRoads }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setSnapped(json);
      } catch (err) {
        setSnapError(String(err instanceof Error ? err.message : err));
      } finally {
        setSnapping(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [waypoints, mode, sport, prefs.surface, prefs.avoidBusyRoads]);

  const handleMapClick = useCallback(
    (p: MapPoint) => {
      if (addingPlace) {
        setPendingPin(p);
        setSnap('half'); // bring the name field back up
      } else if (pickingStart) {
        setCustomStart(p);
        setPickingStart(false);
        setSnap('half');
      } else if (mode === 'draw') {
        setWaypoints(w => [...w, p]);
      }
    },
    [addingPlace, pickingStart, mode]
  );

  const selectWorkout = (idx: number | null) => {
    setSelWorkoutIdx(idx);
    if (idx === null) return;
    const w = workouts[idx];
    const s = detectSport(w);
    if (s) setSport(s);
    if (w.date) setDate(w.date);
    if (w.distanceMeters) setDistanceMi((w.distanceMeters / MI).toFixed(1));
  };

  const generate = async () => {
    if (!startPoint) return;
    setGenLoading(true);
    setGenError('');
    setResult(null);
    try {
      const res = await fetch('/api/routes/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          distanceMeters: parseFloat(distanceMi) * MI,
          date,
          start: startPoint,
          prefs,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setResult(json);
      setSelCand(0);
      setFormCollapsed(true);
      setSnap('half'); // map + candidate list both visible
      bumpFit();
    } catch (err) {
      setGenError(String(err instanceof Error ? err.message : err));
    } finally {
      setGenLoading(false);
    }
  };

  const editCandidate = (c: Candidate) => {
    skipSnapRef.current = true;
    setWaypoints(c.waypoints);
    setSnapped({ geojson: c.geojson as SavedRoute['geojson'], distanceMeters: c.distanceMeters, ascentMeters: c.ascentMeters });
    setMode('draw');
    setSnap('peek'); // editing happens on the map
    bumpFit();
  };

  const startSave = (defaultName: string, body: Record<string, unknown>) => {
    pendingBodyRef.current = body;
    setSaveName(defaultName);
  };

  const confirmSave = async () => {
    const body = pendingBodyRef.current;
    if (!body || !saveName?.trim()) return;
    pendingBodyRef.current = null;
    const name = saveName.trim();
    setSaveName(null);
    await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...body }),
    });
    await loadSaved();
    setMode('saved');
  };

  const savePlace = async () => {
    if (!pendingPin || !placeName.trim()) return;
    await fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: placeName.trim(), ...pendingPin, isDefault: places.length === 0 }),
    });
    setAddingPlace(false);
    setPendingPin(null);
    setPlaceName('');
    loadPlaces();
  };

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(pos =>
      setPendingPin({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    );
  };

  // Map content per mode
  let lines: MapLine[] = [];
  if (mode === 'suggest' && result) {
    lines = result.candidates.map((c, i) => ({
      id: `cand-${i}`,
      coordinates: c.geojson.coordinates,
      color: i === selCand ? CAND_COLORS[0] : CAND_COLORS[(i % 2) + 1],
      dim: i !== selCand,
    }));
  } else if (mode === 'draw' && snapped) {
    lines = [{ id: 'draft', coordinates: snapped.geojson.coordinates, color: CAND_COLORS[0] }];
  } else if (mode === 'saved') {
    const r = savedRoutes.find(x => x.id === selSavedId);
    if (r) lines = [{ id: r.id, coordinates: r.geojson.coordinates, color: CAND_COLORS[0] }];
  }

  const selSaved = savedRoutes.find(r => r.id === selSavedId);

  // Bottom padding for map fitBounds — the area the sheet covers. 'full' uses
  // the half value: fits are for reading the map, which you do at half or peek.
  const sheetInset = snap === 'peek' ? 150 : Math.round(Math.max(areaH, 240) * 0.52);

  const sheetHeader = (
    <div className="space-y-2">
      <div className="flex bg-surface rounded-xl p-1 border border-surface-border">
        {([
          ['suggest', 'Suggest'],
          ['draw', 'Draw'],
          ['saved', 'Saved'],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              if (m !== 'suggest') setPickingStart(false);
              // Drawing happens on the map — get the sheet out of the way.
              setSnap(m === 'draw' ? 'peek' : 'half');
            }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              mode === m ? 'bg-primary text-white' : 'text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'draw' && (
        <div className="flex items-center gap-2 text-sm px-1">
          <span className="font-medium">{snapped ? miles(snapped.distanceMeters) : '0.0 mi'}</span>
          {snapped && <span className="text-xs text-muted">{feet(snapped.ascentMeters)} climb</span>}
          {snapping && <span className="text-xs text-muted animate-pulse">snapping…</span>}
          <div className="flex-1" />
          <button
            onClick={() => setWaypoints(w => w.slice(0, -1))}
            disabled={waypoints.length === 0}
            aria-label="Undo last point"
            className="p-2 -my-2 rounded-lg text-muted disabled:opacity-40 active:text-primary"
          >
            <Undo2 size={16} />
          </button>
        </div>
      )}
      {(pickingStart || (addingPlace && !pendingPin)) && (
        <p className="text-xs text-amber-400 px-1">Tap the map to drop the pin.</p>
      )}
    </div>
  );

  return (
    <div ref={areaRef} className="relative h-full min-h-[320px]">
      <RouteMap
        lines={lines}
        waypoints={mode === 'draw' ? waypoints : []}
        startPin={startPoint}
        pendingPin={pendingPin}
        center={center}
        fitKey={`${mode}-${fitKey}-${selCand}-${selSavedId ?? ''}`}
        fitBottomInset={sheetInset}
        onMapClick={handleMapClick}
        onWaypointMove={(i, p) => setWaypoints(w => w.map((x, j) => (j === i ? p : x)))}
        onWaypointTap={i => setWaypoints(w => w.filter((_, j) => j !== i))}
      />

      <BottomSheet containerHeight={areaH} snap={snap} onSnapChange={setSnap} header={sheetHeader}>

      {/* Start point + places (shared by suggest & draw; hidden while the
          suggest form is collapsed — the summary row carries the start name) */}
      {mode !== 'saved' && !(mode === 'suggest' && formCollapsed && result) && (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-3 space-y-2">
          <p className="text-xs text-muted font-medium flex items-center gap-1.5">
            <MapPin size={13} /> Start point
          </p>
          <div className="flex flex-wrap gap-1.5">
            {places.map(p => (
              <Chip
                key={p.id}
                active={!customStart && startPlace?.id === p.id}
                onClick={() => {
                  setStartPlaceId(p.id);
                  setCustomStart(null);
                  bumpFit();
                }}
              >
                {p.name}
                {p.is_default ? ' ★' : ''}
              </Chip>
            ))}
            <Chip
              active={!!customStart || pickingStart}
              onClick={() => {
                setPickingStart(true);
                setSnap('peek'); // free up the map to tap
              }}
            >
              {customStart ? 'Pinned start' : pickingStart ? 'Tap map…' : 'Drop pin'}
            </Chip>
            <Chip active={addingPlace} onClick={() => setAddingPlace(a => !a)}>
              + Save a place
            </Chip>
          </div>
          {places.length === 0 && !addingPlace && (
            <p className="text-xs text-amber-400">Save a home-base place first — suggestions start from it.</p>
          )}
          {addingPlace && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted">Tap the map to drop the pin, or use your location.</p>
              <div className="flex gap-2">
                <input
                  value={placeName}
                  onChange={e => setPlaceName(e.target.value)}
                  placeholder="Name (Home, Trailhead…)"
                  className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button onClick={useMyLocation} aria-label="Use my location" className="px-3 rounded-lg border border-surface-border text-muted">
                  <Locate size={16} />
                </button>
                <button
                  onClick={savePlace}
                  disabled={!pendingPin || !placeName.trim()}
                  className="px-4 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUGGEST MODE */}
      {mode === 'suggest' && formCollapsed && result && (
        <button
          onClick={() => setFormCollapsed(false)}
          className="flex items-center justify-between gap-3 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 text-left"
        >
          <p className="text-sm min-w-0 truncate">
            {sport === 'running' ? 'Run' : 'Ride'} · {distanceMi} mi · {fmtWorkoutDate(date)}
            <span className="text-muted"> · from {customStart ? 'pinned start' : startPlace?.name ?? 'start'}</span>
          </p>
          <span className="flex items-center gap-1 text-xs text-primary font-medium flex-shrink-0">
            <Pencil size={13} /> Edit
          </span>
        </button>
      )}

      {mode === 'suggest' && !(formCollapsed && result) && (
        <>
          <div className="bg-surface-card border border-surface-border rounded-2xl p-3 space-y-3">
            <p className="text-xs text-muted font-medium">Workout</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={selWorkoutIdx === null} onClick={() => selectWorkout(null)}>
                Custom
              </Chip>
              {workouts.slice(0, 8).map((w, i) => (
                <Chip key={`${w.date}-${i}`} active={selWorkoutIdx === i} onClick={() => selectWorkout(i)}>
                  {fmtWorkoutDate(w.date!)} · {w.name ?? detectSport(w)}
                </Chip>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              {(['running', 'cycling'] as const).map(s => (
                <Chip key={s} active={sport === s} onClick={() => setSport(s)}>
                  {s === 'running' ? 'Run' : 'Ride'}
                </Chip>
              ))}
              <input
                value={distanceMi}
                onChange={e => setDistanceMi(e.target.value)}
                inputMode="decimal"
                className="w-16 bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:border-primary"
              />
              <span className="text-xs text-muted">mi</span>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="flex-1 bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>

            <p className="text-xs text-muted font-medium pt-1">Preferences</p>
            <div className="flex flex-wrap gap-1.5">
              {(['trails', 'mixed', 'roads'] as const).map(s => (
                <Chip key={s} active={prefs.surface === s} onClick={() => setPrefs(p => ({ ...p, surface: s }))}>
                  {s === 'trails' ? 'Trails' : s === 'roads' ? 'Roads' : 'Mixed'}
                </Chip>
              ))}
              <span className="w-px bg-surface-border mx-0.5" />
              {(['flat', 'any', 'hilly'] as const).map(e => (
                <Chip key={e} active={prefs.elevation === e} onClick={() => setPrefs(p => ({ ...p, elevation: e }))}>
                  {e === 'any' ? 'Any terrain' : e === 'flat' ? 'Flat' : 'Hilly'}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['loop', 'out_and_back'] as const).map(s => (
                <Chip key={s} active={prefs.shape === s} onClick={() => setPrefs(p => ({ ...p, shape: s }))}>
                  {s === 'loop' ? 'Loop' : 'Out & back'}
                </Chip>
              ))}
              <Chip active={prefs.avoidBusyRoads} onClick={() => setPrefs(p => ({ ...p, avoidBusyRoads: !p.avoidBusyRoads }))}>
                Avoid busy roads
              </Chip>
            </div>

            <button
              onClick={generate}
              disabled={!startPoint || genLoading || !(parseFloat(distanceMi) > 0)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary rounded-xl text-sm font-medium text-white disabled:opacity-40"
            >
              <Sparkles size={16} className={genLoading ? 'animate-pulse' : ''} />
              {genLoading ? 'Building routes…' : 'Suggest routes'}
            </button>
            {genError && <p className="text-xs text-red-400">{genError}</p>}
          </div>
        </>
      )}

      {mode === 'suggest' && (
        <>
          {result && <WindCard wind={result.wind} windy={result.windy} date={date} />}

          {result?.candidates.map((c, i) => (
            <button
              key={c.name}
              onClick={() => {
                setSelCand(i);
                bumpFit();
              }}
              className={`text-left bg-surface-card border rounded-2xl p-3 space-y-1.5 transition-colors ${
                i === selCand ? 'border-primary' : 'border-surface-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: i === selCand ? CAND_COLORS[0] : CAND_COLORS[(i % 2) + 1] }} />
                  {c.name}
                </p>
                <span className="text-xs text-muted">
                  {miles(c.distanceMeters)} · {feet(c.ascentMeters)}
                </span>
              </div>
              <p className="text-xs text-muted">{c.explanation}</p>
              {i === selCand && (
                <div className="flex gap-2 pt-1">
                  <span
                    role="button"
                    onClick={e => {
                      e.stopPropagation();
                      editCandidate(c);
                    }}
                    className="flex items-center gap-1 text-xs text-primary font-medium"
                  >
                    <Pencil size={13} /> Edit on map
                  </span>
                  <span
                    role="button"
                    onClick={e => {
                      e.stopPropagation();
                      startSave(`${c.name} — ${fmtWorkoutDate(date)}`, {
                        sport,
                        workoutDate: date,
                        distanceMeters: c.distanceMeters,
                        ascentMeters: c.ascentMeters,
                        geojson: c.geojson,
                        waypoints: c.waypoints,
                        prefs,
                        wind: result.wind,
                        source: 'suggested',
                      });
                    }}
                    className="flex items-center gap-1 text-xs text-primary font-medium"
                  >
                    <Save size={13} /> Save route
                  </span>
                </div>
              )}
            </button>
          ))}
        </>
      )}

      {/* DRAW MODE */}
      {mode === 'draw' && (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-3 space-y-3">
          <p className="text-xs text-muted">
            Tap the map to add points — the route snaps to {sport === 'running' ? 'runnable paths' : 'ridable roads'}. Drag a
            point to move it, tap it to remove it.
          </p>
          <div className="flex gap-2">
            {(['running', 'cycling'] as const).map(s => (
              <Chip key={s} active={sport === s} onClick={() => setSport(s)}>
                {s === 'running' ? 'Run' : 'Ride'}
              </Chip>
            ))}
          </div>
          {snapError && <p className="text-xs text-red-400">{snapError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setWaypoints(w => w.slice(0, -1))}
              disabled={waypoints.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-surface-border text-xs text-muted disabled:opacity-40"
            >
              <Undo2 size={14} /> Undo
            </button>
            <button
              onClick={() => {
                setWaypoints([]);
                setSnapped(null);
              }}
              disabled={waypoints.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-surface-border text-xs text-muted disabled:opacity-40"
            >
              <RotateCcw size={14} /> Clear
            </button>
            <button
              onClick={() => setWaypoints(w => (w.length >= 2 ? [...w, w[0]] : w))}
              disabled={waypoints.length < 2}
              className="flex-1 py-2 rounded-lg border border-surface-border text-xs text-muted disabled:opacity-40"
            >
              Close loop
            </button>
            <button
              onClick={() =>
                snapped &&
                startSave(`${sport === 'running' ? 'Run' : 'Ride'} route — ${miles(snapped.distanceMeters)}`, {
                  sport,
                  workoutDate: null,
                  distanceMeters: snapped.distanceMeters,
                  ascentMeters: snapped.ascentMeters,
                  geojson: snapped.geojson,
                  waypoints,
                  prefs,
                  source: 'manual',
                })
              }
              disabled={!snapped}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-40"
            >
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      )}

      {/* SAVED MODE */}
      {mode === 'saved' &&
        (savedRoutes.length === 0 ? (
          <p className="text-center text-sm text-muted py-8">No saved routes yet — suggest or draw one.</p>
        ) : (
          savedRoutes.map(r => (
            <button
              key={r.id}
              onClick={() => {
                setSelSavedId(r.id);
                setConfirmDeleteId(null);
                bumpFit();
              }}
              className={`text-left bg-surface-card border rounded-2xl p-3 ${
                r.id === selSavedId ? 'border-primary' : 'border-surface-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{r.name}</p>
                <span className="text-xs text-muted">
                  {miles(r.distance_meters)}
                  {r.ascent_meters != null ? ` · ${feet(r.ascent_meters)}` : ''}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                {r.sport === 'running' ? 'Run' : 'Ride'} · {r.source === 'suggested' ? 'AI suggested' : 'hand-drawn'}
                {r.workout_date ? ` · for ${fmtWorkoutDate(r.workout_date)}` : ''}
              </p>
              {r.id === selSavedId && (
                <div className="flex gap-3 pt-2">
                  {r.waypoints && r.waypoints.length >= 2 && (
                    <span
                      role="button"
                      onClick={e => {
                        e.stopPropagation();
                        skipSnapRef.current = true;
                        setWaypoints(r.waypoints!);
                        setSnapped({ geojson: r.geojson, distanceMeters: r.distance_meters, ascentMeters: r.ascent_meters ?? 0 });
                        setSport(r.sport);
                        setMode('draw');
                        setSnap('peek');
                        bumpFit();
                      }}
                      className="flex items-center gap-1 text-xs text-primary font-medium"
                    >
                      <Pencil size={13} /> Edit
                    </span>
                  )}
                  <span
                    role="button"
                    onClick={async e => {
                      e.stopPropagation();
                      if (confirmDeleteId !== r.id) {
                        setConfirmDeleteId(r.id);
                        return;
                      }
                      await fetch(`/api/routes/${r.id}`, { method: 'DELETE' });
                      setConfirmDeleteId(null);
                      setSelSavedId(null);
                      loadSaved();
                    }}
                    className={`flex items-center gap-1 text-xs font-medium ${
                      confirmDeleteId === r.id ? 'text-red-400 bg-red-950/60 border border-red-800/50 rounded-lg px-2 py-1' : 'text-red-400'
                    }`}
                  >
                    <Trash2 size={13} /> {confirmDeleteId === r.id ? 'Tap again to delete' : 'Delete'}
                  </span>
                </div>
              )}
            </button>
          ))
        ))}

      </BottomSheet>

      {/* Save-name dialog */}
      {saveName !== null && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={() => setSaveName(null)}>
          <div className="w-full max-w-md bg-surface-card border-t border-surface-border rounded-t-2xl p-4 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Save route</p>
              <button onClick={() => setSaveName(null)} aria-label="Cancel">
                <X size={18} className="text-muted" />
              </button>
            </div>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={confirmSave}
              disabled={!saveName.trim()}
              className="w-full py-2.5 bg-primary rounded-xl text-sm font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
