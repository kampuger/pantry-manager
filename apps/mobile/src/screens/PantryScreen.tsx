import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getFreshnessFlag } from '@pantry/core';
import { pantrySeed } from '../data/seed';

export function PantryScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Pantry Inventory</Text>
      {pantrySeed.map((item) => {
        const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={[styles.badge, { backgroundColor: flagged ? '#fee2e2' : item.status === 'low' ? '#fef3c7' : '#dcfce7', color: flagged ? '#b91c1c' : item.status === 'low' ? '#92400e' : '#166534' }]}>
                {flagged ? 'flagged' : item.status}
              </Text>
            </View>
            <Text>{item.quantity} {item.unit}</Text>
            <Text>{item.location} • {item.category}</Text>
            <Text>Last restock: {new Date(item.lastRestock).toLocaleDateString()}</Text>
            <Text>Expires: {item.expiry}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  itemCard: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '600' },
  badge: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, textTransform: 'capitalize' },
});
