import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, font } from '../lib/theme';

export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.chip, option === value && styles.chipSelected]}
        >
          <Text style={option === value ? styles.chipTextSelected : styles.chipText}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: 13, color: color.foreground, fontFamily: font.regular },
  chipTextSelected: { fontSize: 13, color: '#fff', fontFamily: font.semibold },
});
