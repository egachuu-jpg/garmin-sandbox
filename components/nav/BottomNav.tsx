'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageCircle, BarChart2, Dumbbell, Map, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/', icon: Home, label: 'Home' },
  { href: '/chat', icon: MessageCircle, label: 'Chat' },
  { href: '/reports', icon: BarChart2, label: 'Reports' },
  { href: '/workouts', icon: Dumbbell, label: 'Workouts' },
  { href: '/routes', icon: Map, label: 'Routes' },
  { href: '/plan', icon: Calendar, label: 'Plan' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface-card border-t border-surface-border safe-bottom z-50">
      <div className="flex">
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-2 pt-3 text-xs transition-colors',
                active ? 'text-primary' : 'text-muted'
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
