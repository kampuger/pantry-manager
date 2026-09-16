'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

// Routes that own their entire viewport (no nav sidebar, no content max-width)
// — currently just the login page, which is meant to feel like a distinct,
// immersive entry point rather than another page inside the app shell.
const CHROMELESS_ROUTES = new Set(['/login']);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (CHROMELESS_ROUTES.has(pathname)) {
    return <div style={{ flex: 1, display: 'flex', minHeight: '100vh' }}>{children}</div>;
  }

  return (
    <>
      <Sidebar />
      <main style={{ flex: 1, padding: '32px 40px', maxWidth: 960 }}>{children}</main>
    </>
  );
}
