'use client';

import { useEffect } from 'react';

// Registers the offline-shell service worker (public/sw.js). Production only —
// a SW in dev caches against a moving target and makes HMR miserable.
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('[sw] registration failed:', err);
    });
  }, []);

  return null;
}
