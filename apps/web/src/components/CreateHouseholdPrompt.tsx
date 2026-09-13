'use client';

import { useState } from 'react';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

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
    <div style={{ ...cardStyle, marginTop: 20, maxWidth: 380, padding: 24 }}>
      <p style={{ margin: 0, color: color.foreground, fontWeight: 600 }}>Set up your household</p>
      <p style={{ margin: '4px 0 0', color: color.mutedForeground, fontSize: 13 }}>
        You&apos;re signed in, but not part of a household yet.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label style={labelStyle}>
          Household name
          <input
            placeholder="e.g. The Santos Family"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
          {submitting ? 'Creating…' : 'Create household'}
        </button>
      </form>
    </div>
  );
}
