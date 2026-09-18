'use client';

import { useSyncExternalStore } from 'react';

// Defaults to false (desktop) so server-rendered/pre-hydration markup always
// matches — a real mobile visitor sees a brief desktop-shaped flash until
// this effect runs, which is the standard tradeoff for a matchMedia-driven
// layout switch without a global CSS file to hold real @media queries.
export function useIsMobile(breakpointPx = 768): boolean {
  const query = `(max-width: ${breakpointPx}px)`;

  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
