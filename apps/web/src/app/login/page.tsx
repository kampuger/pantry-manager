'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthProvider';

export default function LoginPage() {
  const { session, signIn, signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    return (
      <div>
        <h1>Already signed in</h1>
        <p>You&apos;re signed in as {session.user.email}.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const result = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password);

    setSubmitting(false);

    if (result.error) {
      setStatus(result.error);
      return;
    }

    if (mode === 'sign-up') {
      setStatus('Account created. If email confirmation is enabled on this project, check your inbox before signing in.');
      return;
    }

    router.push('/pantry');
  }

  return (
    <div style={{ maxWidth: 360 }}>
      <h1>{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        {status && <p style={{ color: '#b91c1c' }}>{status}</p>}
        <button type="submit" disabled={submitting} style={{ padding: 8, cursor: 'pointer' }}>
          {submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        </button>
      </form>
      <button
        onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        style={{ marginTop: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}
      >
        {mode === 'sign-in' ? "Need an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
