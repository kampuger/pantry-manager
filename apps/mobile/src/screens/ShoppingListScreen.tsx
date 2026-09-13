import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { shoppingSeed } from '../data/seed';

export function ShoppingListScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Shopping List</Text>
      {shoppingSeed.map((item) => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.headerRow}>
            <Text style={[styles.name, item.checked && styles.checked]}>{item.name}</Text>
            <Text style={[styles.priority, { color: item.priority === 'High' ? '#dc2626' : item.priority === 'Medium' ? '#d97706' : '#15803d' }]}>{item.priority}</Text>
          </View>
          <Text>{item.quantity} • {item.category}</Text>
          <Text style={styles.cost}>₱{item.estimatedCost}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  itemCard: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '600' },
  checked: { textDecorationLine: 'line-through' },
  priority: { fontWeight: '600' },
  cost: { fontWeight: '700', marginTop: 4 },
});
