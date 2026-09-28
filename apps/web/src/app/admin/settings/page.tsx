// apps/web/src/app/admin/settings/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { checkIsPlatformAdmin, getAppSettings, setEmailNotificationsEnabled } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { color, cardStyle, labelStyle } from '@/lib/theme';

function AlertBanner({ tone, children }: { tone: 'destructive' | 'success'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'destructive' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
        background: tone === 'destructive' ? color.destructiveBg : color.successBg,
        color: tone === 'destructive' ? color.destructive : color.success,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontWeight: 700 }}>{tone === 'destructive' ? '!' : '✓'}</span>
      <span>{children}</span>
    </div>
  );
}

export default function AdminSettingsPage() {
  const { session, loading: authLoading } = useAuth();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabledState] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setCheckingAccess(false);
      return;
    }
    checkIsPlatformAdmin(supabase)
      .then((ok) => {
        setIsAdmin(ok);
        if (ok) {
          getAppSettings(supabase)
            .then((settings) => setEmailNotificationsEnabledState(settings.emailNotificationsEnabled))
            .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load settings'));
        }
      })
      .finally(() => setCheckingAccess(false));
  }, [session]);

  async function handleToggle() {
    if (!session) return;
    const next = !emailNotificationsEnabled;
    setSaving(true);
    setSaveError(null);
    try {
      await setEmailNotificationsEnabled(supabase, next, session.user.id);
      setEmailNotificationsEnabledState(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update setting');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || checkingAccess) return null;

  if (!session) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Admin</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            Sign in
          </a>{' '}
          to continue.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Admin</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>App-wide configuration.</p>
      </header>

      {loadError && <AlertBanner tone="destructive">{loadError}</AlertBanner>}

      <section style={{ ...cardStyle, padding: 20, display: 'grid', gap: 12 }}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={emailNotificationsEnabled}
            disabled={saving}
            onChange={handleToggle}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: 'block', fontWeight: 600, color: color.foreground }}>Email notifications</span>
            <span style={{ display: 'block', fontSize: 13, color: color.mutedForeground, fontWeight: 400, marginTop: 2 }}>
              When off, no household&apos;s expiry reminder digest emails go out, regardless of each household&apos;s own
              schedule or each member&apos;s notification preference.
            </span>
          </span>
        </label>
        {saveError && <AlertBanner tone="destructive">{saveError}</AlertBanner>}
      </section>
    </div>
  );
}
