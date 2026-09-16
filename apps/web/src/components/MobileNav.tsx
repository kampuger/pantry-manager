'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { color, radius, shadow } from '@/lib/theme';
import { NAV_ITEMS } from './navItems';
import { NotificationBell } from './notifications/NotificationBell';

export const MOBILE_TOP_BAR_HEIGHT = 56;
export const MOBILE_BOTTOM_BAR_HEIGHT = 64;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  async function handleSignOut() {
    setMenuOpen(false);
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
          padding: '0 16px',
          background: color.card,
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {session && membership && membership !== 'loading' && (
            <NotificationBell householdId={membership.householdId} userId={session.user.id} />
          )}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Account menu"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: radius.sm, color: color.mutedForeground, display: 'flex' }}
            >
              <IconAccount />
            </button>
            {menuOpen && (
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
                    onClick={() => setMenuOpen(false)}
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

      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          height: MOBILE_BOTTOM_BAR_HEIGHT,
          display: 'flex',
          background: color.card,
          borderTop: `1px solid ${color.border}`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                textDecoration: 'none',
                color: active ? color.primary : color.mutedForeground,
              }}
            >
              <Icon />
              <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
