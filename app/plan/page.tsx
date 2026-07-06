import { redirect } from 'next/navigation';

// The Plan tab merged into Training — keep old bookmarks working.
export default function PlanRedirect() {
  redirect('/training?tab=plan');
}
