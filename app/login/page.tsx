'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });

    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Invalid passphrase');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🏃</div>
          <h1 className="text-2xl font-bold">Garmin Coach</h1>
          <p className="text-muted mt-1 text-sm">Your AI training partner</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Passphrase"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-4 text-base focus:outline-none focus:border-primary transition-colors"
            autoFocus
            autoComplete="current-password"
          />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !passphrase}
            className="w-full bg-primary text-white rounded-xl py-4 text-base font-semibold disabled:opacity-40 active:scale-95 transition-transform"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
