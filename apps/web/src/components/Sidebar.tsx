'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/AuthProvider';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/pantry', label: 'Pantry' },
  { href: '/recipe', label: 'Recipe' },
  { href: '/shopping-list', label: 'Shop' },
  { href: '/financials', label: 'Financial' },
];

export function Sidebar() {
  const { session, loading, signOut } = useAuth();

  return (
    <nav style={{ width: 200, borderRight: '1px solid #ddd', padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '100vh' }}>
      <div>
        {NAV_ITEMS.map((item) => (
          <div key={item.href} style={{ marginBottom: 12 }}>
            <Link href={item.href}>{item.label}</Link>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, borderTop: '1px solid #eee', paddingTop: 12 }}>
        {loading ? null : session ? (
          <>
            <div style={{ color: '#64748b', marginBottom: 6, wordBreak: 'break-all' }}>{session.user.email}</div>
            <button onClick={() => signOut()} style={{ cursor: 'pointer' }}>
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </div>
    </nav>
  );
}
