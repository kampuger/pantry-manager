'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export default function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    // Clicking the emailed reset link establishes a short-lived "recovery"
    // session (Supabase parses it from the URL hash on load, via
    // AuthProvider's existing onAuthStateChange listener) — updateUser()
    // always acts on whatever session is currently active, recovery or not.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.push('/pantry');
  }

  if (loading) return null;

  if (!session) {
    return (
      <div style={{ maxWidth: 380, margin: '40px auto 0' }}>
        <div style={{ ...cardStyle, padding: 32 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Reset link needed</h1>
          <p style={{ color: color.mutedForeground, marginTop: 6, fontSize: 14 }}>
            This page only works when opened from a password-reset email.{' '}
            <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
              Request a new one
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 380, margin: '40px auto 0' }}>
      <div style={{ ...cardStyle, padding: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Set a new password</h1>
        <p style={{ color: color.mutedForeground, marginTop: 6, fontSize: 14 }}>
          Choose a new password for {session.user.email}.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, marginTop: 24 }}>
          <label style={labelStyle}>
            New password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Confirm password
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
            />
          </label>
          {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
          <button type="submit" disabled={submitting} style={{ ...buttonStyle('primary'), width: '100%' }}>
            {submitting ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
