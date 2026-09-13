import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { getFreshnessFlag } from '@pantry/core';
import { budgetSeed, pantrySeed, shoppingSeed } from '../data/seed';
import { useAuth } from '../lib/AuthProvider';

export function DashboardScreen() {
  const { session, signOut } = useAuth();
  const expiringCount = pantrySeed.filter((item) => item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category)).length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.label}>Overview</Text>
          <Text style={styles.title}>Dashboard</Text>
        </View>
        <Pressable onPress={() => signOut()}>
          <Text style={styles.signOut}>Sign out{session?.user.email ? ` (${session.user.email})` : ''}</Text>
        </Pressable>
      </View>

      <View style={styles.cardGrid}>
        {[
          { label: 'Pantry Items', value: pantrySeed.length },
          { label: 'Flagged Fresh', value: expiringCount },
          { label: 'Shopping List', value: shoppingSeed.length },
          { label: 'Budget Left', value: `₱${budgetSeed.remaining.toLocaleString()}` },
        ].map((card) => (
          <View key={card.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{card.label}</Text>
            <Text style={styles.metricValue}>{card.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Pantry status</Text>
        {pantrySeed.slice(0, 4).map((item) => (
          <View key={item.id} style={styles.row}>
            <Text>{item.name}</Text>
            <Text style={{ color: item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category) ? '#dc2626' : item.status === 'low' ? '#d97706' : '#15803d', fontWeight: '600' }}>
              {item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category) ? 'flagged' : item.status}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  signOut: { color: '#2563eb', fontSize: 12, maxWidth: 140, textAlign: 'right' },
  label: { color: '#64748b', fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '700', marginTop: 4 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, width: '47%' },
  metricLabel: { color: '#64748b', fontSize: 12 },
  metricValue: { fontSize: 24, fontWeight: '700', marginTop: 6 },
  panel: { backgroundColor: '#fff', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16 },
  panelTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
});
