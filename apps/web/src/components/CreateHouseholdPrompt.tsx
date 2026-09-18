'use client';

import { useState } from 'react';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

type Mode = 'create' | 'join';

export function CreateHouseholdPrompt({
  onCreate,
  onJoin,
}: {
  onCreate: (name: string) => Promise<unknown>;
  onJoin: (code: string) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Generated codes are always uppercase — trimming and uppercasing
      // here means a lowercase-typed code still matches without the user
      // needing to notice case.
      if (mode === 'join') await onJoin(code.trim().toUpperCase());
      else await onCreate(name);
    } catch (err) {
      const fallback = mode === 'join' ? 'Failed to join household' : 'Failed to create household';
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...cardStyle, marginTop: 20, maxWidth: 380, padding: 24 }}>
      <p style={{ margin: 0, color: color.foreground, fontWeight: 600 }}>
        {mode === 'create' ? 'Set up your household' : 'Join a household'}
      </p>
      <p style={{ margin: '4px 0 0', color: color.mutedForeground, fontSize: 13 }}>
        You&apos;re signed in, but not part of a household yet.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {mode === 'create' ? (
          <label style={labelStyle}>
            Household name
            <input
              placeholder="e.g. The Santos Family"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </label>
        ) : (
          <label style={labelStyle}>
            Invite code
            <input
              placeholder="e.g. AB3DEFGH"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}
        {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
          {submitting
            ? mode === 'create'
              ? 'Creating…'
              : 'Joining…'
            : mode === 'create'
              ? 'Create household'
              : 'Join household'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => switchMode(mode === 'create' ? 'join' : 'create')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginTop: 12,
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          color: color.primary,
        }}
      >
        {mode === 'create' ? 'Have an invite code instead?' : 'Create a new household instead'}
      </button>
    </div>
  );
}
