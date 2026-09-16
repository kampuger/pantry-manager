'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { checkIsPlatformAdmin } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { color, radius, shadow } from '@/lib/theme';
import { NAV_ITEMS, IconAdmin } from './navItems';
import { NotificationBell } from './notifications/NotificationBell';

export const MOBILE_TOP_BAR_HEIGHT = 56;

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IconAccount() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

export function MobileNav() {
  const { session, signOut } = useAuth();
  const { membership } = useHousehold();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!navOpen && !accountOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (navOpen && navRef.current && !navRef.current.contains(e.target as Node)) setNavOpen(false);
      if (accountOpen && accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [navOpen, accountOpen]);

  // Close the nav dropdown automatically once the route actually changes —
  // covers taps that Link's own onClick handler might miss (e.g. a
  // already-active item re-tapped).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    setAccountOpen(false);
    await signOut();
    router.push('/login');
  }

  return (
    <>
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: MOBILE_TOP_BAR_HEIGHT,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 0 8px',
          background: color.card,
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div ref={navRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: radius.sm, color: color.foreground, display: 'flex' }}
          >
            {navOpen ? <IconClose /> : <IconMenu />}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, marginLeft: 4 }}>
            <div
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: radius.sm,
                background: color.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              P
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: color.foreground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Pantry Tracker
            </span>
          </div>

          {navOpen && (
            <>
              <div
                aria-hidden
                onClick={() => setNavOpen(false)}
                style={{ position: 'fixed', inset: 0, top: MOBILE_TOP_BAR_HEIGHT, background: 'rgba(15, 23, 42, 0.35)', zIndex: 39 }}
              />
              <nav
                style={{
                  position: 'fixed',
                  top: MOBILE_TOP_BAR_HEIGHT,
                  left: 0,
                  right: 0,
                  zIndex: 41,
                  background: color.card,
                  borderBottom: `1px solid ${color.border}`,
                  boxShadow: shadow.raised,
                  padding: 8,
                  display: 'grid',
                  gap: 2,
                }}
              >
                {NAV_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setNavOpen(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        borderRadius: radius.sm,
                        fontSize: 15,
                        fontWeight: active ? 700 : 500,
                        textDecoration: 'none',
                        color: active ? color.primary : color.foreground,
                        background: active ? color.muted : 'transparent',
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
                    onClick={() => setNavOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: radius.sm,
                      fontSize: 15,
                      fontWeight: pathname === '/admin/users' ? 700 : 500,
                      textDecoration: 'none',
                      color: pathname === '/admin/users' ? color.primary : color.foreground,
                      background: pathname === '/admin/users' ? color.muted : 'transparent',
                    }}
                  >
                    <IconAdmin />
                    Admin
                  </Link>
                )}
              </nav>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {session && membership && membership !== 'loading' && (
            <NotificationBell householdId={membership.householdId} userId={session.user.id} />
          )}
          <div ref={accountRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setAccountOpen((v) => !v)}
              aria-label="Account menu"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: radius.sm, color: color.mutedForeground, display: 'flex' }}
            >
              <IconAccount />
            </button>
            {accountOpen && (
              <div
                style={{
                  boxShadow: shadow.raised,
                  position: 'absolute',
                  top: '120%',
                  right: 0,
                  minWidth: 210,
                  background: color.card,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.md,
                  padding: 12,
                  zIndex: 50,
                }}
              >
                {session ? (
                  <>
                    <div style={{ fontSize: 12, color: color.mutedForeground, wordBreak: 'break-all', marginBottom: 10 }}>
                      {session.user.email}
                    </div>
                    <button
                      onClick={handleSignOut}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        cursor: 'pointer',
                        border: `1px solid ${color.border}`,
                        background: color.muted,
                        color: color.foreground,
                        borderRadius: radius.sm,
                        padding: '8px 10px',
                        fontSize: 13,
                        fontFamily: 'inherit',
                      }}
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <Link
                    href="/login"
                    onClick={() => setAccountOpen(false)}
                    style={{ color: color.primary, fontWeight: 600, textDecoration: 'none', fontSize: 13 }}
                  >
                    Sign in
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
