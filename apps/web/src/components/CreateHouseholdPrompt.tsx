'use client';

import { useState } from 'react';

export function CreateHouseholdPrompt({ onCreate }: { onCreate: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 20, maxWidth: 360 }}>
      <p>You&apos;re signed in, but not part of a household yet.</p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <input
          placeholder="Household name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: 8, cursor: 'pointer' }}>
          {submitting ? 'Creating…' : 'Create household'}
        </button>
      </form>
    </div>
  );
}
