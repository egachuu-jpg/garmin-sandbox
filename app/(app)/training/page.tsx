import { TrainingTabs } from '@/components/training/TrainingTabs';

export const dynamic = 'force-dynamic';

// Training = the old Workouts (Scheduled + Gear) and Plan tabs merged into one
// destination. ?tab=plan|gear deep-links a segment (used by the /plan redirect).
export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = tab === 'plan' ? 'plan' : tab === 'gear' ? 'gear' : 'schedule';

  return (
    <div className="flex flex-col min-h-screen bg-surface pb-24">
      <div className="px-4 safe-top pb-2">
        <h1 className="text-2xl font-bold">Training</h1>
      </div>
      <TrainingTabs initialTab={initialTab} />
    </div>
  );
}
