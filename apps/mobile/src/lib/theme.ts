// Shared design tokens for apps/mobile — mirrors apps/web/src/lib/theme.ts.
// Palette: "Grocery & Shopping List" (fresh green + food amber),
// typography: Plus Jakarta Sans (loaded via @expo-google-fonts), style:
// Minimalism & Swiss (clean, functional, card-based).
import type { TextStyle, ViewStyle } from 'react-native';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

export const color = {
  primary: '#059669',
  primaryDark: '#047857',
  secondary: '#10B981',
  accent: '#D97706',
  background: '#F7FBF9',
  foreground: '#0F172A',
  card: '#FFFFFF',
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

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

// RN doesn't support numeric `fontWeight` alongside a custom `fontFamily`
// the way CSS does — each weight needs its own explicit font family name.
export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

export function useAppFonts() {
  return useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
}

export const cardStyle: ViewStyle = {
  backgroundColor: color.card,
  borderWidth: 1,
  borderColor: color.border,
  borderRadius: radius.md,
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

export const inputStyle: TextStyle & ViewStyle = {
  borderWidth: 1,
  borderColor: color.border,
  borderRadius: radius.sm,
  paddingVertical: 10,
  paddingHorizontal: 12,
  fontFamily: font.regular,
  fontSize: 14,
  color: color.foreground,
  backgroundColor: color.card,
};

export function badgeColors(tone: 'success' | 'warning' | 'destructive' | 'muted') {
  const map = {
    success: { background: color.successBg, color: color.success },
    warning: { background: color.warningBg, color: color.warning },
    destructive: { background: color.destructiveBg, color: color.destructive },
    muted: { background: color.muted, color: color.mutedForeground },
  } as const;
  return map[tone];
}
