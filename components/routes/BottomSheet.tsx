'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

type Props = {
  /** Height (px) of the area the sheet lives in — measured by the parent. */
  containerHeight: number;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Always visible (part of the peek height alongside the drag handle). */
  header: React.ReactNode;
  children: React.ReactNode;
};

// Draggable bottom sheet over the map. Gesture arbitration is solved by
// construction: ONLY the handle strip is draggable (touch-action: none there
// and nowhere else), so map pans, header button taps, and content scrolling
// never compete with the sheet drag. Pointer capture stays on the handle,
// which also keeps synthetic click events away from header buttons.
export function BottomSheet({ containerHeight, snap, onSnapChange, header, children }: Props) {
  const topRef = useRef<HTMLDivElement>(null); // handle + header — defines peek height
  const [peekHeight, setPeekHeight] = useState(120);
  // Non-null only while a drag is in progress.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; height: number; moved: boolean } | null>(null);

  // Measure the always-visible top section so peek never clips the header
  // (its height varies by mode — e.g. the draw-mode stat row).
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const measure = () => setPeekHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const snapHeights = useCallback(
    (): Record<SheetSnap, number> => {
      const h = Math.max(containerHeight, 240);
      return {
        peek: Math.min(peekHeight, h - 80),
        half: Math.round(h * 0.52),
        full: h - 12,
      };
    },
    [containerHeight, peekHeight]
  );

  const height = dragHeight ?? snapHeights()[snap];

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: e.clientY, height, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dy = start.y - e.clientY; // up = grow
    if (Math.abs(dy) > 6) start.moved = true;
    if (start.moved) {
      const { peek, full } = snapHeights();
      setDragHeight(Math.min(full, Math.max(peek, start.height + dy)));
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    dragStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (!start.moved) {
      // Tap on the handle: toggle between peek and half (full taps down to half).
      setDragHeight(null);
      onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'peek' : 'half');
      return;
    }

    const finalHeight = dragHeight ?? height;
    setDragHeight(null);
    const heights = snapHeights();
    const nearest = (Object.keys(heights) as SheetSnap[]).reduce((best, key) =>
      Math.abs(heights[key] - finalHeight) < Math.abs(heights[best] - finalHeight) ? key : best
    );
    onSnapChange(nearest);
  };

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col bg-surface-card border-t border-x border-surface-border rounded-t-2xl shadow-[0_-8px_24px_rgba(0,0,0,0.45)] ${
        dragHeight === null ? 'transition-[height] duration-300 ease-out' : ''
      }`}
      style={{ height }}
    >
      <div ref={topRef} className="flex-shrink-0">
        {/* Drag handle — the only draggable surface. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
          role="button"
          aria-label={snap === 'peek' ? 'Expand panel' : 'Collapse panel'}
        >
          <div className="w-10 h-1 rounded-full bg-surface-border" />
        </div>
        <div className="px-3 pb-2">{header}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-8 space-y-3">
        {children}
      </div>
    </div>
  );
}
