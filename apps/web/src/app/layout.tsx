import type { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';

export const metadata = {
  title: 'Pantry Tracker',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, display: 'flex' }}>
        <Sidebar />
        <main style={{ flex: 1, padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
