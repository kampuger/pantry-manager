import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { getFreshnessFlag, formatPHP } from '@pantry/core';
import { budgetSeed, pantrySeed, shoppingSeed } from '../data/seed';
import { useAuth } from '../lib/AuthProvider';
import { Badge } from '../components/Badge';
import { color, cardStyle, font } from '../lib/theme';

export function DashboardScreen() {
  const { session, signOut } = useAuth();
  const expiringCount = pantrySeed.filter((item) => item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category)).length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
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
          { label: 'Budget Left', value: formatPHP(budgetSeed.remaining) },
        ].map((card) => (
          <View key={card.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{card.label}</Text>
            <Text style={styles.metricValue}>{card.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Pantry status</Text>
        {pantrySeed.slice(0, 4).map((item) => {
          const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);
          const tone = flagged ? 'destructive' : item.status === 'low' ? 'warning' : 'success';
          return (
            <View key={item.id} style={styles.row}>
              <Text style={styles.rowLabel}>{item.name}</Text>
              <Badge tone={tone}>{flagged ? 'flagged' : item.status}</Badge>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  signOut: { color: color.primary, fontSize: 12, maxWidth: 140, textAlign: 'right', fontFamily: font.medium },
  label: { color: color.mutedForeground, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: font.semibold },
  title: { fontSize: 30, fontFamily: font.bold, color: color.foreground, marginTop: 4 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { ...cardStyle, padding: 16, width: '47%' },
  metricLabel: { color: color.mutedForeground, fontSize: 12, fontFamily: font.medium },
  metricValue: { fontSize: 22, fontFamily: font.bold, color: color.foreground, marginTop: 6 },
  panel: { ...cardStyle, padding: 16 },
  panelTitle: { fontSize: 16, fontFamily: font.bold, color: color.foreground, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.border },
  rowLabel: { fontFamily: font.regular, color: color.foreground },
});
