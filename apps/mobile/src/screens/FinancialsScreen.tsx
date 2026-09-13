import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatPHP } from '@pantry/core';
import { budgetSeed } from '../data/seed';
import { color, cardStyle, font } from '../lib/theme';

export function FinancialsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Financial snapshot</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.label}>Monthly budget</Text>
        <Text style={styles.value}>{formatPHP(budgetSeed.monthlyBudget)}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Spending</Text>
        {[
          { label: 'Groceries', amount: 920 },
          { label: 'Meat & Fish', amount: 630 },
          { label: 'Dairy', amount: 280 },
          { label: 'Produce', amount: 310 },
        ].map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.amount}>{formatPHP(row.amount)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground },
  summaryCard: { ...cardStyle, padding: 20 },
  label: { color: color.mutedForeground, fontSize: 12, fontFamily: font.medium },
  value: { marginTop: 8, fontSize: 28, fontFamily: font.bold, color: color.foreground },
  panel: { ...cardStyle, padding: 16 },
  panelTitle: { fontSize: 16, fontFamily: font.bold, color: color.foreground, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontFamily: font.regular, color: color.foreground },
  amount: { fontFamily: font.bold, color: color.foreground },
});
