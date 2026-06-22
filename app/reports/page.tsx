import Link from 'next/link';
import { BottomNav } from '@/components/nav/BottomNav';

const REPORTS = [
  {
    emoji: '📊',
    title: 'Weekly Summary',
    description: 'Mileage, pace, training load, sleep avg, HRV trend',
    prompt: 'Generate a weekly training summary. Include total mileage, average pace, training load, sleep quality, and HRV trends for this week.',
  },
  {
    emoji: '🏁',
    title: 'Race Readiness',
    description: 'VO2max trend, long run history, sub-4 projection',
    prompt: 'Assess my current race readiness for the Mankato Marathon sub-4 goal. Check VO2max, recent long runs, training load, and project my likely finish time.',
  },
  {
    emoji: '💚',
    title: 'Recovery Patterns',
    description: 'Body battery, stress, HRV overlay — last 30 days',
    prompt: 'Analyze my recovery patterns over the past 30 days. Look at body battery trends, stress levels, HRV, and sleep quality. Identify any concerning patterns.',
  },
  {
    emoji: '👟',
    title: 'Gear Mileage',
    description: 'Shoe wear tracking and replacement alerts',
    prompt: 'Review my gear mileage. Check all tracked shoes and equipment, flag anything approaching replacement thresholds, and advise on rotation strategy given my SI joint condition.',
  },
];

export default function ReportsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted text-sm mt-1">AI analysis of your training data</p>
      </div>

      <div className="px-4 mt-4 space-y-3">
        {REPORTS.map(report => (
          <Link
            key={report.title}
            href={`/chat?prompt=${encodeURIComponent(report.prompt)}`}
            className="flex items-center gap-4 bg-surface-card border border-surface-border rounded-2xl p-4 active:bg-surface-border transition-colors"
          >
            <span className="text-2xl w-10 text-center flex-shrink-0">{report.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{report.title}</p>
              <p className="text-sm text-muted mt-0.5 leading-snug">{report.description}</p>
            </div>
            <span className="text-muted text-lg flex-shrink-0">›</span>
          </Link>
        ))}
      </div>

      <BottomNav />
    </div>
  );
}
