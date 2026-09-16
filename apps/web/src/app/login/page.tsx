'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthProvider';
import { color, radius, shadow } from '@/lib/theme';

type Mode = 'sign-in' | 'sign-up' | 'forgot-password';

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-10.5-7-10.5-7a19.9 19.9 0 0 1 4.22-5.06M9.9 4.24A10.4 10.4 0 0 1 12 5c7 0 10.5 7 10.5 7a19.86 19.86 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M4 10h16M4 17h16M9 3v18" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20V10M9 20V4M15 20v-7M21 20V8" />
    </svg>
  );
}

const FEATURES: { icon: () => React.ReactNode; text: string }[] = [
  { icon: IconBox, text: 'Track everything across Fridge, Freezer & Pantry' },
  { icon: IconClock, text: 'Get reminded before food quietly goes bad' },
  { icon: IconChart, text: 'See exactly what you spend — and what you waste' },
];

const shellStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexWrap: 'wrap',
  minHeight: '100vh',
  width: '100%',
};

const visualPaneStyle: CSSProperties = {
  flex: '1 1 420px',
  minWidth: 320,
  boxSizing: 'border-box',
  position: 'relative',
  overflow: 'hidden',
  background: `radial-gradient(120% 140% at 15% 10%, ${color.secondary} 0%, ${color.primary} 45%, ${color.primaryDark} 100%)`,
  color: '#fff',
  padding: 'clamp(32px, 6vw, 72px) clamp(28px, 6vw, 64px)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 32,
};

const formPaneStyle: CSSProperties = {
  flex: '1 1 420px',
  minWidth: 320,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(28px, 6vw, 64px)',
  background: color.background,
};

export default function LoginPage() {
  const { session, loading, signIn, signUp, resetPassword } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [submitHovered, setSubmitHovered] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Already signed in? Don't dead-end here — this page's job is to get
  // someone signed in, and once that's true there's nothing left to do.
  useEffect(() => {
    if (!loading && session) router.replace('/pantry');
  }, [loading, session, router]);

  if (loading || session) return null;

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
      setStatus(result.error ?? 'If that email has an account, a reset link is on its way — check your inbox.');
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

  const heading = mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create your account' : 'Reset your password';
  const subheading =
    mode === 'sign-in'
      ? "Sign in to see what's in your kitchen."
      : mode === 'sign-up'
        ? 'Set up your household in under a minute.'
        : "Enter your email and we'll send you a reset link.";
  const submitLabel = mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : 'Send reset link';

  const fieldStyle = (focused: boolean): CSSProperties => ({
    width: '100%',
    boxSizing: 'border-box',
    padding: '13px 14px 13px 42px',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: focused ? color.primary : color.border,
    boxShadow: focused ? `0 0 0 4px ${color.primary}1f` : 'none',
    fontFamily: 'inherit',
    fontSize: 14,
    background: color.card,
    color: color.foreground,
    outline: 'none',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
  });

  return (
    <div style={shellStyle}>
      <section style={visualPaneStyle} aria-hidden={false}>
        {/* Decorative soft glows — purely visual, no content behind them. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -80,
            right: -80,
            width: 260,
            height: 260,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.10)',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: -100,
            left: -60,
            width: 220,
            height: 220,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.sm,
              background: 'rgba(255,255,255,0.16)',
              border: '1px solid rgba(255,255,255,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            P
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>Pantry Tracker</span>
        </div>

        <div style={{ position: 'relative', maxWidth: 420 }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(26px, 3.4vw, 38px)', lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Know what&apos;s in your kitchen — before it&apos;s too late.
          </h1>
          <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.88)' }}>
            One shared home for what your household owns, what&apos;s about to expire, and what it&apos;s all costing you.
          </p>

          <div style={{ display: 'grid', gap: 14, marginTop: 32 }}>
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    borderRadius: radius.sm,
                    background: 'rgba(255,255,255,0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon />
                </div>
                <span style={{ fontSize: 14, lineHeight: 1.4, color: 'rgba(255,255,255,0.95)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ position: 'relative', margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
          Built for households who&apos;d rather cook it than toss it.
        </p>
      </section>

      <section style={formPaneStyle}>
        <div
          style={{
            width: '100%',
            maxWidth: 380,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 400ms ease, transform 400ms ease',
          }}
        >
          <div
            style={{
              background: color.card,
              border: `1px solid ${color.border}`,
              borderRadius: radius.lg,
              boxShadow: shadow.raised,
              padding: 'clamp(24px, 4vw, 36px)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: color.foreground, letterSpacing: '-0.01em' }}>
              {heading}
            </h2>
            <p style={{ color: color.mutedForeground, marginTop: 6, fontSize: 14 }}>{subheading}</p>

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, marginTop: 26 }}>
              <div>
                <label
                  htmlFor="email"
                  style={{ display: 'block', fontSize: 13, fontWeight: 600, color: color.mutedForeground, marginBottom: 6 }}
                >
                  Email
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: color.mutedForeground, pointerEvents: 'none' }}>
                    <IconMail />
                  </span>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    style={fieldStyle(emailFocused)}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              {mode !== 'forgot-password' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <label htmlFor="password" style={{ fontSize: 13, fontWeight: 600, color: color.mutedForeground }}>
                      Password
                    </label>
                    {mode === 'sign-in' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot-password')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12.5, fontWeight: 600, color: color.primary, fontFamily: 'inherit' }}
                        suppressHydrationWarning
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: color.mutedForeground, pointerEvents: 'none' }}>
                      <IconLock />
                    </span>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      style={{ ...fieldStyle(passwordFocused), paddingRight: 42 }}
                      suppressHydrationWarning
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 6,
                        color: color.mutedForeground,
                        display: 'flex',
                      }}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
              )}

              {status && (
                <p
                  role="status"
                  style={{
                    margin: 0,
                    padding: '10px 14px',
                    borderRadius: radius.sm,
                    fontSize: 13,
                    lineHeight: 1.5,
                    background: statusIsError ? color.destructiveBg : color.successBg,
                    color: statusIsError ? color.destructive : color.success,
                  }}
                >
                  {status}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                onMouseEnter={() => setSubmitHovered(true)}
                onMouseLeave={() => setSubmitHovered(false)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '13px 20px',
                  borderRadius: radius.md,
                  border: 'none',
                  cursor: submitting ? 'default' : 'pointer',
                  background: color.primary,
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 15,
                  fontWeight: 700,
                  opacity: submitting ? 0.75 : 1,
                  transform: submitHovered && !submitting ? 'translateY(-1px)' : 'translateY(0)',
                  boxShadow: submitHovered && !submitting ? shadow.raised : 'none',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
                }}
                suppressHydrationWarning
              >
                {submitting ? 'Please wait…' : submitLabel}
              </button>
            </form>

            <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13.5 }}>
              {mode === 'forgot-password' ? (
                <button
                  onClick={() => switchMode('sign-in')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600, color: color.primary }}
                  suppressHydrationWarning
                >
                  Back to sign in
                </button>
              ) : (
                <span style={{ color: color.mutedForeground }}>
                  {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
                  <button
                    onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600, color: color.primary }}
                    suppressHydrationWarning
                  >
                    {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
