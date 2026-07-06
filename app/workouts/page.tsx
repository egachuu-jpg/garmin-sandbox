import { redirect } from 'next/navigation';

// The Workouts tab merged into Training — keep old bookmarks working.
export default function WorkoutsRedirect() {
  redirect('/training');
}
