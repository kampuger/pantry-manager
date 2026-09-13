import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Button, ActivityIndicator, Pressable } from 'react-native';
import {
  addGroceryListEntry,
  setGroceryListEntryChecked,
  deleteGroceryListEntry,
  UNIT_OPTIONS,
  type Database,
} from '@pantry/supabase-client';
import { shoppingSeed } from '../data/seed';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { CreateHouseholdPrompt } from '../components/CreateHouseholdPrompt';
import { ChipSelect } from '../components/ChipSelect';

type GroceryListEntryRow = Database['public']['Tables']['grocery_list_entries']['Row'];

function DemoShoppingList() {
  return (
    <>
      {shoppingSeed.map((item) => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.headerRow}>
            <Text style={[styles.name, item.checked && styles.checked]}>{item.name}</Text>
            <Text
              style={[
                styles.priority,
                { color: item.priority === 'High' ? '#dc2626' : item.priority === 'Medium' ? '#d97706' : '#15803d' },
              ]}
            >
              {item.priority}
            </Text>
          </View>
          <Text>
            {item.quantity} • {item.category}
          </Text>
          <Text style={styles.cost}>₱{item.estimatedCost}</Text>
        </View>
      ))}
    </>
  );
}

function AddEntryForm({
  householdId,
  userId,
  onAdded,
}: {
  householdId: string;
  userId: string;
  onAdded: () => void;
}) {
  const NO_UNIT = 'none';
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<string>(NO_UNIT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addGroceryListEntry(supabase, householdId, userId, {
        name: name.trim(),
        quantity: quantity ? Number(quantity) : null,
        unit: unit === NO_UNIT ? null : unit,
      });
      setName('');
      setQuantity('');
      setUnit(NO_UNIT);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add entry');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.addForm}>
      <Text style={styles.addFormTitle}>Add to list</Text>
      <TextInput placeholder="Item" value={name} onChangeText={setName} style={styles.input} />
      <TextInput
        placeholder="Quantity (optional)"
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>Unit (optional)</Text>
      <ChipSelect options={[NO_UNIT, ...UNIT_OPTIONS] as const} value={unit} onChange={setUnit} />
      {error && <Text style={{ color: '#b91c1c' }}>{error}</Text>}
      <Button title={submitting ? 'Adding…' : 'Add to list'} onPress={handleSubmit} disabled={submitting} />
    </View>
  );
}

function RealShoppingList({ entries, onChanged }: { entries: GroceryListEntryRow[]; onChanged: () => void }) {
  if (entries.length === 0) {
    return <Text style={{ color: '#64748b' }}>Your shopping list is empty.</Text>;
  }

  async function toggle(entry: GroceryListEntryRow) {
    await setGroceryListEntryChecked(supabase, entry.id, !entry.is_checked);
    onChanged();
  }

  async function remove(entry: GroceryListEntryRow) {
    await deleteGroceryListEntry(supabase, entry.id);
    onChanged();
  }

  return (
    <>
      {entries.map((entry) => (
        <View key={entry.id} style={styles.entryRow}>
          <Pressable onPress={() => toggle(entry)} style={styles.entryTouchable}>
            <View style={[styles.checkbox, entry.is_checked && styles.checkboxChecked]} />
            <Text style={[styles.entryName, entry.is_checked && styles.checked]}>
              {entry.name}
              {entry.quantity != null && ` — ${entry.quantity}${entry.unit ? ` ${entry.unit}` : ''}`}
            </Text>
          </Pressable>
          <Pressable onPress={() => remove(entry)}>
            <Text style={{ color: '#b91c1c' }}>Remove</Text>
          </Pressable>
        </View>
      ))}
    </>
  );
}

export function ShoppingListScreen() {
  const { session } = useAuth();
  const { membership, create } = useHousehold();
  const [entries, setEntries] = useState<GroceryListEntryRow[]>([]);

  const refreshEntries = useCallback((householdId: string) => {
    supabase
      .from('grocery_list_entries')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setEntries(data ?? []));
  }, []);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    refreshEntries(membership.householdId);
  }, [membership, refreshEntries]);

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Shopping List</Text>
        <DemoShoppingList />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Shopping List</Text>
      {membership === 'loading' && <ActivityIndicator />}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <AddEntryForm
            householdId={membership.householdId}
            userId={session.user.id}
            onAdded={() => refreshEntries(membership.householdId)}
          />
          <RealShoppingList entries={entries} onChanged={() => refreshEntries(membership.householdId)} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12 },
  itemCard: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '600' },
  checked: { textDecorationLine: 'line-through', color: '#94a3b8' },
  priority: { fontWeight: '600' },
  cost: { fontWeight: '700', marginTop: 4 },
  addForm: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  addFormTitle: { fontSize: 16, fontWeight: '700' },
  fieldLabel: { fontSize: 12, color: '#64748b', marginBottom: -4 },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  entryTouchable: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  entryName: { flexShrink: 1 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#94a3b8' },
  checkboxChecked: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
});
