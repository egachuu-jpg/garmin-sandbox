// Daily workout schedule for the 17-week Mankato Marathon plan, transcribed
// from mankato-marathon-training-plan.md (Section 3, July 2026 revision:
// 3:50 A-goal / 8:45 MGP, Monday strength, Tuesday medium-longs, half tune-up
// in Week 14). Keyed by week number so the home screen shows the workout for
// the athlete's *actual current week*. Keep in sync with the plan doc AND
// lib/coach-prompt.ts — the coach quotes the same zones.

type DayEntry = { title: string; detail: string };
type WeekEntry = Record<string, DayEntry>;

const EASY_ZONE = 'Target: 10:00–10:45/mi';
const MGP_ZONE = 'Target: 8:40–8:50/mi (MGP portion)';
const INTERVAL_ZONE = 'Target: 7:40–8:10/mi (interval portion)';
const FUELING = 'Practice race fueling: 40–60g carbs/hr from mile 4–5';

const rest: DayEntry = { title: 'Complete Rest', detail: 'Recovery & SI prep' };
const easy = (mi: number, si = false, strength = false): DayEntry => ({
  title: `${mi} mi easy${si ? ' + SI Routine' : ''}${strength ? ' + Block C strength' : ''}`,
  detail: strength ? `${EASY_ZONE} · keep the run genuinely easy on strength days` : EASY_ZONE,
});
const medLong = (mi: number): DayEntry => ({
  title: `${mi} mi medium-long run`,
  detail: EASY_ZONE,
});
const longRun = (mi: number, note?: string, detail = EASY_ZONE): DayEntry => ({
  title: `${mi} mi ${note ?? 'easy long run'}`,
  detail,
});
const tempo = (totalMi: number, mgpMi: number): DayEntry => ({
  title: `${totalMi} mi tempo run (${mgpMi} mi @ 8:45 MGP)`,
  detail: MGP_ZONE,
});
const intervals = (totalMi: number, reps: string, pace = '7:50'): DayEntry => ({
  title: `${totalMi} mi intervals (${reps} @ ${pace} pace)`,
  detail: INTERVAL_ZONE,
});
const bike = (mins: number, note = 'Recovery spin — low resistance, steady cadence'): DayEntry => ({
  title: `${mins} min bike ride`,
  detail: note,
});
const spin = (mins: number): DayEntry => ({
  title: `${mins} min very easy spin`,
  detail: 'Recovery — keep resistance minimal',
});

export const WORKOUTS_BY_WEEK: Record<number, WeekEntry> = {
  1: {
    Monday: easy(3, true),
    Tuesday: easy(3, true),
    Wednesday: bike(30, 'Low resistance, 85+ RPM'),
    Thursday: { title: '2 mi easy shakeout run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: longRun(5, 'recovery long run'),
    Sunday: rest,
  },
  2: {
    Monday: easy(4, true),
    Tuesday: easy(3, true),
    Wednesday: bike(45),
    Thursday: easy(4),
    Friday: rest,
    Saturday: longRun(8),
    Sunday: rest,
  },
  3: {
    Monday: easy(4, true, true),
    Tuesday: easy(4, true),
    Wednesday: bike(45, 'Focus on smooth, 85+ RPM spinning'),
    Thursday: tempo(5, 2),
    Friday: rest,
    Saturday: longRun(10),
    Sunday: rest,
  },
  4: {
    Monday: easy(5, true),
    Tuesday: easy(4, true),
    Wednesday: bike(60, 'Flat, fluid ride'),
    Thursday: tempo(5, 3),
    Friday: rest,
    Saturday: longRun(12),
    Sunday: rest,
  },
  5: {
    Monday: easy(5, true, true),
    Tuesday: easy(5, true),
    Wednesday: bike(60),
    Thursday: intervals(6, '5×800m'),
    Friday: rest,
    Saturday: longRun(13),
    Sunday: rest,
  },
  6: {
    Monday: easy(5, true, true),
    Tuesday: easy(5, true),
    Wednesday: bike(60),
    Thursday: tempo(7, 4),
    Friday: rest,
    Saturday: longRun(14, 'long run', `${EASY_ZONE} · ${FUELING}`),
    Sunday: rest,
  },
  7: {
    // Step-back week — good shoe-rotation window if near 400 miles.
    Monday: easy(4, true),
    Tuesday: easy(4, true),
    Wednesday: bike(45, 'Easy recovery spin'),
    Thursday: { title: '5 mi easy run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: longRun(10),
    Sunday: rest,
  },
  8: {
    Monday: easy(6, true, true),
    Tuesday: medLong(8),
    Wednesday: bike(60),
    Thursday: intervals(7, '4×1200m', '7:55'),
    Friday: rest,
    Saturday: longRun(15, 'long run', `${EASY_ZONE} · ${FUELING}`),
    Sunday: rest,
  },
  9: {
    Monday: easy(6, true, true),
    Tuesday: medLong(8),
    Wednesday: bike(75),
    Thursday: tempo(8, 5),
    Friday: rest,
    Saturday: longRun(16, 'long run', `Final 2 mi @ 8:45 MGP · ${FUELING}`),
    Sunday: rest,
  },
  10: {
    // Step-back week — second shoe-rotation window before the peak block.
    Monday: easy(4, true),
    Tuesday: easy(5, true),
    Wednesday: bike(45, 'Easy recovery spin'),
    Thursday: { title: '6 mi easy run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: longRun(12),
    Sunday: rest,
  },
  11: {
    // Peak volume week.
    Monday: easy(6, true, true),
    Tuesday: medLong(9),
    Wednesday: bike(75),
    Thursday: intervals(8, '6×1000m'),
    Friday: rest,
    Saturday: longRun(18, 'long run', `Final 3 mi @ 8:45 MGP · ${FUELING}`),
    Sunday: rest,
  },
  12: {
    Monday: easy(6, true, true),
    Tuesday: easy(6, true),
    Wednesday: bike(60),
    Thursday: tempo(9, 6),
    Friday: rest,
    Saturday: longRun(14, 'long run', `${EASY_ZONE} · ${FUELING}`),
    Sunday: rest,
  },
  13: {
    // Peak long run week — midweek deliberately light so legs are fresh.
    Monday: easy(6, true),
    Tuesday: easy(7, true),
    Wednesday: spin(45),
    Thursday: { title: '5 mi easy run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: {
      title: '20 mi peak long run',
      detail: 'First 15 mi @ 10:15, miles 16–19 @ 8:45 MGP, final mile easy · full race-fueling rehearsal',
    },
    Sunday: rest,
  },
  14: {
    // Tune-up race week (Sat Sep 26).
    Monday: easy(5, true),
    Tuesday: easy(4, true),
    Wednesday: bike(45, 'Easy recovery spin'),
    Thursday: { title: '4 mi easy + 4 strides', detail: EASY_ZONE },
    Friday: { title: 'Rest (pre-race)', detail: 'Block D mobility only' },
    Saturday: {
      title: 'Half marathon tune-up race',
      detail: 'Strong, controlled — MGP to ~10 sec/mi faster. Dress rehearsal, not a PR attempt',
    },
    Sunday: rest,
  },
  15: {
    Monday: easy(4, true, true), // reduced Block C (30 min)
    Tuesday: easy(4, true),
    Wednesday: bike(45, 'Easy recovery spin'),
    Thursday: tempo(6, 3),
    Friday: rest,
    Saturday: longRun(10, 'long run', 'Final 2–3 mi @ 8:45 MGP'),
    Sunday: rest,
  },
  16: {
    Monday: easy(3, true, true), // reduced Block C (30 min)
    Tuesday: { title: '4 mi easy + SI Routine + 4 strides', detail: EASY_ZONE },
    Wednesday: spin(30),
    Thursday: tempo(4, 2),
    Friday: rest,
    Saturday: { title: '6 mi easy run', detail: 'Middle 2 mi @ 8:45 MGP to keep the legs sharp' },
    Sunday: rest,
  },
  17: {
    Monday: { title: '3 mi easy shakeout', detail: EASY_ZONE },
    Tuesday: { title: '3 mi easy + 4×1 min @ MGP + strides', detail: 'Keeps the legs primed — an all-rest race week leaves them flat' },
    Wednesday: rest,
    Thursday: { title: '2 mi easy shakeout + 2 strides', detail: EASY_ZONE },
    Friday: { title: 'Rest — travel to Mankato', detail: 'Packet pickup at Scheels Expo · begin carb-load (~7–10 g/kg)' },
    Saturday: { title: 'Mankato Marathon — Race Day! 🏁', detail: 'A-goal 3:50 (8:45/mi) · defend sub-4:00 (9:09/mi)' },
    Sunday: { title: 'Recovery', detail: 'You did it — full rest' },
  },
};

export function getDayWorkout(week: number, dayName: string): DayEntry {
  const clampedWeek = Math.max(1, Math.min(17, week));
  return WORKOUTS_BY_WEEK[clampedWeek]?.[dayName] ?? rest;
}
