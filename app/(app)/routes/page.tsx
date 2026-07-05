'use client';

import dynamic from 'next/dynamic';

// MapLibre needs the browser (WebGL, window) — skip SSR for the whole builder.
const RouteBuilder = dynamic(() => import('@/components/routes/RouteBuilder'), {
  ssr: false,
  loading: () => <div className="h-[42vh] min-h-[280px] rounded-2xl bg-surface-card border border-surface-border animate-pulse" />,
});

export default function RoutesPage() {
  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <h1 className="text-2xl font-bold">Routes</h1>
      </div>
      <div className="flex-1 px-4 mt-2">
        <RouteBuilder />
      </div>
    </div>
  );
}
