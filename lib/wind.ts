// Wind forecast for route suggestions, via Open-Meteo (free, no API key).
// Forecasts cover ~16 days out; beyond that we return null and the route
// builder falls back to wind-agnostic suggestions.

import { compassLabel } from './geo';

export type WindForecast = {
  date: string; // YYYY-MM-DD
  speedMph: number; // max sustained wind for the day
  gustMph: number;
  directionDeg: number; // meteorological: direction the wind blows FROM
  directionLabel: string; // e.g. "NW"
};

/** Sustained wind at/above this is "windy" — routes get reshaped around it. */
export const WINDY_THRESHOLD_MPH = 12;

export async function getWindForecast(
  lat: number,
  lng: number,
  date: string
): Promise<WindForecast | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant` +
    `&wind_speed_unit=mph&timezone=America%2FChicago` +
    `&start_date=${date}&end_date=${date}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      daily?: {
        time?: string[];
        wind_speed_10m_max?: (number | null)[];
        wind_gusts_10m_max?: (number | null)[];
        wind_direction_10m_dominant?: (number | null)[];
      };
    };
    const speed = json.daily?.wind_speed_10m_max?.[0];
    const direction = json.daily?.wind_direction_10m_dominant?.[0];
    if (typeof speed !== 'number' || typeof direction !== 'number') return null;

    return {
      date,
      speedMph: Math.round(speed),
      gustMph: Math.round(json.daily?.wind_gusts_10m_max?.[0] ?? speed),
      directionDeg: Math.round(direction),
      directionLabel: compassLabel(direction),
    };
  } catch {
    // Forecast is a nice-to-have — never fail route generation over it.
    return null;
  }
}
