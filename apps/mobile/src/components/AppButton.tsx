import { Pressable, Text, StyleSheet, type ViewStyle } from 'react-native';
import { color, radius, font } from '../lib/theme';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
}

export function AppButton({ title, onPress, disabled, variant = 'primary', style }: AppButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.base, variantStyles[variant], disabled && styles.disabled, style]}
    >
      <Text style={[styles.text, variant === 'secondary' ? styles.textSecondary : styles.textOnColor]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  text: { fontFamily: font.semibold, fontSize: 14 },
  textOnColor: { color: '#fff' },
  textSecondary: { color: color.foreground },
});

const variantStyles: Record<NonNullable<AppButtonProps['variant']>, ViewStyle> = {
  primary: { backgroundColor: color.primary },
  secondary: { backgroundColor: color.muted, borderWidth: 1, borderColor: color.border },
  danger: { backgroundColor: color.destructive },
};
