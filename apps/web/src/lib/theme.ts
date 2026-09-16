// Shared design tokens for apps/web. Palette: "Grocery & Shopping List"
// (fresh green + food amber), typography: Plus Jakarta Sans, style:
// Minimalism & Swiss (clean, functional, card-based) — chosen for a
// household pantry/budget tool used daily, not a marketing site.
import type { CSSProperties } from 'react';

export const color = {
  primary: '#059669',
  primaryDark: '#047857',
  secondary: '#10B981',
  accent: '#D97706',
  background: '#F7FBF9',
  foreground: '#0F172A',
  card: '#FFFFFF',
  cardForeground: '#0F172A',
  muted: '#F0F8F6',
  mutedForeground: '#5B6B75',
  border: '#E1EEE8',
  destructive: '#DC2626',
  destructiveBg: '#FEF2F2',
  warning: '#D97706',
  warningBg: '#FFFBEB',
  success: '#059669',
  successBg: '#ECFDF5',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
  raised: '0 2px 8px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)',
} as const;

export const space = (n: number) => n * 4;

export const font = {
  family: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const cardStyle: CSSProperties = {
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  boxShadow: shadow.card,
};

export const inputStyle: CSSProperties = {
  // border-box so any caller that also sets a width (100%, a fixed px value,
  // a flex-basis) gets that width inclusive of padding+border — otherwise
  // (this app has no global CSS reset) the browser's content-box default
  // adds padding on top of the specified width, overflowing the container.
  boxSizing: 'border-box',
  // Every call site wraps this in a `display:grid`/flex label meaning to
  // stretch it to the label's width, but a number input's browser-intrinsic
  // min-content size (its spinner controls) can exceed a narrow grid cell —
  // grid/flex items default to `min-width:auto`, so the browser honors that
  // intrinsic size over the stretch and overflows the container. width:100%
  // plus minWidth:0 makes the input actually fill (and shrink to) its cell.
  width: '100%',
  minWidth: 0,
  padding: '10px 12px',
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  fontFamily: 'inherit',
  fontSize: 14,
  background: color.card,
  color: color.foreground,
  outline: 'none',
};

export function buttonStyle(variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary'): CSSProperties {
  // Longhand border properties throughout (never the `border` shorthand) —
  // some buttons in the app switch variant on the same DOM element at
  // runtime (e.g. a pressed/unpressed toggle), and React warns when a
  // rerender needs to add/remove `borderColor` while a `border` shorthand
  // is also present, since the two can't be reconciled property-by-property.
  const base: CSSProperties = {
    // Same reasoning as inputStyle's boxSizing — a caller giving the button
    // an explicit width (e.g. width:'100%' on a full-width submit button)
    // must not have padding added on top of it.
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    padding: '10px 18px',
    borderRadius: radius.sm,
    cursor: 'pointer',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    transition: 'opacity 150ms ease, background 150ms ease',
  };
  if (variant === 'primary') return { ...base, background: color.primary, color: '#fff' };
  if (variant === 'secondary') return { ...base, background: color.muted, color: color.foreground, borderColor: color.border };
  if (variant === 'danger') {
    return { ...base, background: 'transparent', color: color.destructive, borderStyle: 'none', padding: '4px 8px' };
  }
  return { ...base, background: 'transparent', color: color.mutedForeground, borderStyle: 'none', padding: 0 };
}

export function badgeStyle(tone: 'success' | 'warning' | 'destructive' | 'muted'): CSSProperties {
  const map = {
    success: { background: color.successBg, color: color.success },
    warning: { background: color.warningBg, color: color.warning },
    destructive: { background: color.destructiveBg, color: color.destructive },
    muted: { background: color.muted, color: color.mutedForeground },
  } as const;
  return {
    ...map[tone],
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}

export const labelStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: color.mutedForeground,
};
