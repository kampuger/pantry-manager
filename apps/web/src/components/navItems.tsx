import type { ReactNode } from 'react';

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
export function IconAdmin() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" />
      <path d="M9.5 12l2 2 3.5-4" />
    </svg>
  );
}

export const NAV_ITEMS: { href: string; label: string; icon: () => ReactNode }[] = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/pantry', label: 'Pantry', icon: IconPantry },
  { href: '/recipe', label: 'Recipe', icon: IconRecipe },
  { href: '/shopping-list', label: 'Shop', icon: IconShop },
  { href: '/financials', label: 'Financial', icon: IconFinancial },
];
