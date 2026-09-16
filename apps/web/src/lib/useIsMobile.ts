'use client';

import { useEffect, useState } from 'react';

// Defaults to false (desktop) so server-rendered/pre-hydration markup always
// matches — a real mobile visitor sees a brief desktop-shaped flash until
// this effect runs, which is the standard tradeoff for a matchMedia-driven
// layout switch without a global CSS file to hold real @media queries.
export function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    setIsMobile(mql.matches);

    function handleChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
    }

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [breakpointPx]);

  return isMobile;
}
