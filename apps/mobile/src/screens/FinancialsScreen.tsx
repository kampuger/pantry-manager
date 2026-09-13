import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatPHP } from '@pantry/core';
import { budgetSeed } from '../data/seed';

export function FinancialsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
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
            <Text>{row.label}</Text>
            <Text style={styles.amount}>{formatPHP(row.amount)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  summaryCard: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 20 },
  label: { color: '#64748b', fontSize: 12 },
  value: { marginTop: 8, fontSize: 30, fontWeight: '700' },
  panel: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16 },
  panelTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  amount: { fontWeight: '700' },
});
