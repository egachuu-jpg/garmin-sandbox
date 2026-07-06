'use client';

import dynamic from 'next/dynamic';

// MapLibre needs the browser (WebGL, window) — skip SSR for the whole builder.
const RouteBuilder = dynamic(() => import('@/components/routes/RouteBuilder'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[320px] rounded-2xl bg-surface-card border border-surface-border animate-pulse" />,
});

export default function RoutesPage() {
  return (
    // Full-height map with the controls in a bottom sheet (h-dvh so mobile
    // browser chrome doesn't push the sheet under the nav).
    <div className="flex flex-col h-dvh bg-surface">
      <div className="px-4 safe-top pb-2 flex-shrink-0">
        <h1 className="text-2xl font-bold">Routes</h1>
      </div>
      <div
        className="flex-1 min-h-0 px-4"
        // Clearance for the fixed BottomNav (its height + iOS safe area).
        style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      >
        <RouteBuilder />
      </div>
    </div>
  );
}
