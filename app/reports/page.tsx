import { redirect } from 'next/navigation';

// Reports became prompt shortcuts inside chat — keep old bookmarks working.
export default function ReportsRedirect() {
  redirect('/chat');
}
