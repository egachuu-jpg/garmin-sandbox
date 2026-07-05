import { BottomNav } from '@/components/nav/BottomNav';

// Every signed-in screen shares the bottom nav via this layout, so the nav
// persists across navigation instead of re-mounting per page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
