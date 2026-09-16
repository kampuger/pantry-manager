'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { checkIsPlatformAdmin } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { color, radius } from '@/lib/theme';
import { NotificationBell } from './notifications/NotificationBell';
import { NAV_ITEMS, IconAdmin } from './navItems';

export function Sidebar() {
  const { session, loading, signOut } = useAuth();
  const { membership } = useHousehold();
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    checkIsPlatformAdmin(supabase)
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [session]);

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  return (
    <nav
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: `1px solid ${color.border}`,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '100vh',
        background: color.card,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: radius.sm,
                background: color.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              P
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: color.foreground }}>Pantry Tracker</span>
          </div>
          {session && membership && membership !== 'loading' && (
            <NotificationBell householdId={membership.householdId} userId={session.user.id} />
          )}
        </div>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                marginBottom: 4,
                borderRadius: radius.sm,
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                textDecoration: 'none',
                color: active ? color.primary : color.mutedForeground,
                background: active ? color.muted : 'transparent',
                transition: 'background 150ms ease, color 150ms ease',
              }}
            >
              <Icon />
              {item.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/admin/users"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: radius.sm,
              fontSize: 14,
              fontWeight: pathname === '/admin/users' ? 600 : 500,
              textDecoration: 'none',
              color: pathname === '/admin/users' ? color.primary : color.mutedForeground,
              background: pathname === '/admin/users' ? color.muted : 'transparent',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            <IconAdmin />
            Admin
          </Link>
        )}
      </div>
      <div style={{ fontSize: 13, borderTop: `1px solid ${color.border}`, paddingTop: 16, padding: '16px 8px 0' }}>
        {loading ? null : session ? (
          <>
            <div style={{ color: color.mutedForeground, marginBottom: 8, wordBreak: 'break-all', fontSize: 12 }}>
              {session.user.email}
            </div>
            <button
              onClick={() => handleSignOut()}
              style={{
                cursor: 'pointer',
                border: `1px solid ${color.border}`,
                background: color.card,
                color: color.foreground,
                borderRadius: radius.sm,
                padding: '6px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login" style={{ color: color.primary, fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
