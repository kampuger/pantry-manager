import { Text, StyleSheet } from 'react-native';
import { radius, font, badgeColors } from '../lib/theme';

export function Badge({ tone, children }: { tone: 'success' | 'warning' | 'destructive' | 'muted'; children: string }) {
  const { background, color: textColor } = badgeColors(tone);
  return <Text style={[styles.badge, { backgroundColor: background, color: textColor }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: font.semibold,
    overflow: 'hidden',
    textTransform: 'capitalize',
  },
});
