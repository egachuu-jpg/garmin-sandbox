// Shared training-plan date math. All "today" calculations are done in the
// athlete's timezone (America/Chicago) so the server's UTC clock can't shift the
// date — e.g. 7pm CT must not read as "tomorrow".

const TZ = 'America/Chicago';
const DAY = 86_400_000;
const PLAN_START_UTC = new Date('2026-06-22T00:00:00Z'); // Week 1, Day 1 (Monday)
const RACE_DAY_UTC = new Date('2026-10-17T00:00:00Z');

// Chicago calendar date (YYYY-MM-DD) anchored to UTC midnight for whole-day math.
function chicagoMidnight(now: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

export type PlanContext = {
  /** e.g. "Tuesday, June 23" */
  todayLabel: string;
  /** e.g. "Tuesday" */
  dayName: string;
  /** Clamped to 1..17 for display */
  week: number;
  /** 1 = Monday .. 7 = Sunday, relative to the plan (which starts Monday) */
  dayOfWeek: number;
  /** Raw (can be negative before the plan / >17 weeks after) */
  daysSinceStart: number;
  /** Raw (negative after race day) */
  daysToRace: number;
  /** Start-of-today in Chicago, as a UTC instant — for DB "today" filters */
  startOfTodayUTC: Date;
};

export function getPlanContext(now: Date = new Date()): PlanContext {
  const today = chicagoMidnight(now);
  const daysSinceStart = Math.round((today.getTime() - PLAN_START_UTC.getTime()) / DAY);
  const daysToRace = Math.round((RACE_DAY_UTC.getTime() - today.getTime()) / DAY);
  const week = Math.max(1, Math.min(17, Math.floor(daysSinceStart / 7) + 1));
  const dayOfWeek = (((daysSinceStart % 7) + 7) % 7) + 1; // plan starts Monday

  const todayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
  }).format(now);

  return {
    todayLabel,
    dayName,
    week,
    dayOfWeek,
    daysSinceStart,
    daysToRace,
    startOfTodayUTC: today,
  };
}
