import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Sidebar } from '@/components/Sidebar';
import { AuthProvider } from '@/lib/AuthProvider';
import { color } from '@/lib/theme';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
});

export const metadata = {
  title: 'Pantry Tracker',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body
        style={{
          margin: 0,
          display: 'flex',
          minHeight: '100vh',
          fontFamily: 'var(--font-jakarta), -apple-system, BlinkMacSystemFont, sans-serif',
          background: color.background,
          color: color.foreground,
        }}
      >
        <AuthProvider>
          <Sidebar />
          <main style={{ flex: 1, padding: '32px 40px', maxWidth: 960 }}>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
