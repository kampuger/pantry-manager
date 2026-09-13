'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/AuthProvider';
import { color, radius } from '@/lib/theme';

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
function IconPantry() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M4 10h16M4 17h16M9 3v18" />
    </svg>
  );
}
function IconRecipe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4z" />
      <path d="M8 8h7M8 12h7M8 16h4" />
    </svg>
  );
}
function IconShop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M2.5 3h2l2.2 11.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20 7H6" />
    </svg>
  );
}
function IconFinancial() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20V10M9 20V4M15 20v-7M21 20V8" />
    </svg>
  );
}

const NAV_ITEMS: { href: string; label: string; icon: () => ReactNode }[] = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/pantry', label: 'Pantry', icon: IconPantry },
  { href: '/recipe', label: 'Recipe', icon: IconRecipe },
  { href: '/shopping-list', label: 'Shop', icon: IconShop },
  { href: '/financials', label: 'Financial', icon: IconFinancial },
];

export function Sidebar() {
  const { session, loading, signOut } = useAuth();
  const pathname = usePathname();

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', marginBottom: 28 }}>
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
      </div>
      <div style={{ fontSize: 13, borderTop: `1px solid ${color.border}`, paddingTop: 16, padding: '16px 8px 0' }}>
        {loading ? null : session ? (
          <>
            <div style={{ color: color.mutedForeground, marginBottom: 8, wordBreak: 'break-all', fontSize: 12 }}>
              {session.user.email}
            </div>
            <button
              onClick={() => signOut()}
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
