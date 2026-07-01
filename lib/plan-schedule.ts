// Daily workout schedule for the 17-week Mankato Marathon plan, transcribed
// from mankato-marathon-training-plan.md (Section 3). Keyed by week number so
// the home screen shows the workout for the athlete's *actual current week*
// instead of always reusing Week 1's schedule.

type DayEntry = { title: string; detail: string };
type WeekEntry = Record<string, DayEntry>;

const EASY_ZONE = 'Target: 10:00–10:45/mi';
const TEMPO_ZONE = 'Target: 9:00–9:09/mi (tempo portion)';
const INTERVAL_ZONE = 'Target: 7:45–8:15/mi (interval portion)';

const rest: DayEntry = { title: 'Complete Rest', detail: 'Recovery & SI prep' };
const easy = (mi: number, si = false): DayEntry => ({
  title: `${mi} mi easy${si ? ' + SI Routine' : ''}`,
  detail: EASY_ZONE,
});
const longRun = (mi: number, note?: string): DayEntry => ({
  title: `${mi} mi ${note ?? 'easy long run'}`,
  detail: EASY_ZONE,
});
const tempo = (totalMi: number, tempoMi: number, pace = '9:00'): DayEntry => ({
  title: `${totalMi} mi tempo run (${tempoMi} mi @ ${pace} pace)`,
  detail: TEMPO_ZONE,
});
const intervals = (totalMi: number, reps: string, pace = '7:50'): DayEntry => ({
  title: `${totalMi} mi intervals (${reps} @ ${pace} pace)`,
  detail: INTERVAL_ZONE,
});
const bike = (mins: number, note = 'Low resistance, steady cadence'): DayEntry => ({
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
    Thursday: easy(4, true),
    Friday: rest,
    Saturday: longRun(8),
    Sunday: rest,
  },
  3: {
    Monday: easy(4, true),
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
    Monday: easy(5),
    Tuesday: easy(5),
    Wednesday: bike(60),
    Thursday: intervals(6, '5×800m'),
    Friday: rest,
    Saturday: longRun(13),
    Sunday: rest,
  },
  6: {
    Monday: easy(5),
    Tuesday: easy(5),
    Wednesday: bike(60),
    Thursday: tempo(7, 4),
    Friday: rest,
    Saturday: longRun(14),
    Sunday: rest,
  },
  7: {
    Monday: easy(4),
    Tuesday: easy(4),
    Wednesday: bike(45),
    Thursday: { title: '5 mi easy run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: longRun(10),
    Sunday: rest,
  },
  8: {
    Monday: easy(6),
    Tuesday: easy(5),
    Wednesday: bike(60),
    Thursday: intervals(7, '4×1200m', '7:55'),
    Friday: rest,
    Saturday: longRun(16),
    Sunday: rest,
  },
  9: {
    Monday: easy(6),
    Tuesday: easy(5),
    Wednesday: bike(75),
    Thursday: tempo(8, 5),
    Friday: rest,
    Saturday: longRun(15),
    Sunday: rest,
  },
  10: {
    Monday: easy(4),
    Tuesday: easy(4),
    Wednesday: bike(45),
    Thursday: { title: '6 mi easy run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: longRun(12),
    Sunday: rest,
  },
  11: {
    Monday: easy(6),
    Tuesday: easy(6),
    Wednesday: bike(75),
    Thursday: intervals(8, '6×1000m'),
    Friday: rest,
    Saturday: longRun(18),
    Sunday: rest,
  },
  12: {
    Monday: easy(6),
    Tuesday: easy(5),
    Wednesday: bike(60),
    Thursday: tempo(9, 6),
    Friday: rest,
    Saturday: longRun(14),
    Sunday: rest,
  },
  13: {
    Monday: easy(6),
    Tuesday: easy(5),
    Wednesday: spin(45),
    Thursday: { title: '5 mi easy run', detail: EASY_ZONE },
    Friday: rest,
    Saturday: {
      title: '20 mi peak long run',
      detail: 'First 15 mi @ 10:15, miles 16–19 @ 9:00, final mile easy',
    },
    Sunday: rest,
  },
  14: {
    Monday: easy(5),
    Tuesday: easy(4),
    Wednesday: bike(60),
    Thursday: tempo(7, 4),
    Friday: rest,
    Saturday: longRun(12),
    Sunday: rest,
  },
  15: {
    Monday: easy(4),
    Tuesday: easy(4),
    Wednesday: bike(45),
    Thursday: tempo(6, 3),
    Friday: rest,
    Saturday: longRun(10),
    Sunday: rest,
  },
  16: {
    Monday: easy(3),
    Tuesday: easy(3),
    Wednesday: spin(30),
    Thursday: tempo(4, 2),
    Friday: rest,
    Saturday: { title: '6 mi easy run', detail: EASY_ZONE },
    Sunday: rest,
  },
  17: {
    Monday: { title: '3 mi easy shakeout', detail: EASY_ZONE },
    Tuesday: rest,
    Wednesday: rest,
    Thursday: { title: '2 mi easy shakeout', detail: EASY_ZONE },
    Friday: { title: 'Rest — travel to Mankato', detail: 'Packet pickup at Scheels Wellness Expo' },
    Saturday: { title: 'Mankato Marathon — Race Day! 🏁', detail: 'Sub-4:00 goal · 9:09/mi pace' },
    Sunday: { title: 'Recovery', detail: 'You did it — full rest' },
  },
};

export function getDayWorkout(week: number, dayName: string): DayEntry {
  const clampedWeek = Math.max(1, Math.min(17, week));
  return WORKOUTS_BY_WEEK[clampedWeek]?.[dayName] ?? rest;
}
