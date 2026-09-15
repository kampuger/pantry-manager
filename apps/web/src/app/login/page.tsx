'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthProvider';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

type Mode = 'sign-in' | 'sign-up' | 'forgot-password';

export default function LoginPage() {
  const { session, signIn, signUp, resetPassword } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('sign-in');
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    return (
      <div>
        <h1>Already signed in</h1>
        <p style={{ color: color.mutedForeground }}>You&apos;re signed in as {session.user.email}.</p>
      </div>
    );
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
    setStatusIsError(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    setStatusIsError(false);

    if (mode === 'forgot-password') {
      const result = await resetPassword(email);
      setSubmitting(false);
      setStatusIsError(!!result.error);
      setStatus(
        result.error ?? 'If that email has an account, a reset link is on its way — check your inbox.'
      );
      return;
    }

    const result = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password);

    setSubmitting(false);

    if (result.error) {
      setStatusIsError(true);
      setStatus(result.error);
      return;
    }

    if (mode === 'sign-up') {
      setStatus('Account created. If email confirmation is enabled on this project, check your inbox before signing in.');
      return;
    }

    router.push('/pantry');
  }

  const heading =
    mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create an account' : 'Reset your password';
  const subheading =
    mode === 'sign-in'
      ? 'Sign in to see your household’s pantry.'
      : mode === 'sign-up'
        ? 'Set up your household in a minute.'
        : 'Enter your email and we’ll send you a reset link.';
  const submitLabel =
    mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Sign up' : 'Send reset link';

  return (
    <div style={{ maxWidth: 380, margin: '40px auto 0' }}>
      <div style={{ ...cardStyle, padding: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{heading}</h1>
        <p style={{ color: color.mutedForeground, marginTop: 6, fontSize: 14 }}>{subheading}</p>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, marginTop: 24 }}>
          <label style={labelStyle}>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              suppressHydrationWarning
            />
          </label>
          {mode !== 'forgot-password' && (
            <label style={labelStyle}>
              Password
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                suppressHydrationWarning
              />
            </label>
          )}
          {mode === 'sign-in' && (
            <button
              type="button"
              onClick={() => switchMode('forgot-password')}
              style={{ ...buttonStyle('ghost'), justifySelf: 'end', fontSize: 13, padding: 0 }}
              suppressHydrationWarning
            >
              Forgot password?
            </button>
          )}
          {status && (
            <p style={{ color: statusIsError ? color.destructive : color.success, fontSize: 13, margin: 0 }}>
              {status}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{ ...buttonStyle('primary'), width: '100%' }}
            suppressHydrationWarning
          >
            {submitting ? 'Please wait…' : submitLabel}
          </button>
        </form>
        {mode === 'forgot-password' ? (
          <button
            onClick={() => switchMode('sign-in')}
            style={{ ...buttonStyle('ghost'), marginTop: 16, color: color.primary, fontWeight: 600 }}
            suppressHydrationWarning
          >
            Back to sign in
          </button>
        ) : (
          <button
            onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            style={{ ...buttonStyle('ghost'), marginTop: 16, color: color.primary, fontWeight: 600 }}
            suppressHydrationWarning
          >
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        )}
      </div>
    </div>
  );
}
