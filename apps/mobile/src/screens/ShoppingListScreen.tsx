import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator, Pressable } from 'react-native';
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
import { AppButton } from '../components/AppButton';
import { color, cardStyle, inputStyle, font } from '../lib/theme';

type GroceryListEntryRow = Database['public']['Tables']['grocery_list_entries']['Row'];

const PRIORITY_COLOR: Record<string, string> = {
  High: color.destructive,
  Medium: color.warning,
  Low: color.success,
};

function DemoShoppingList() {
  return (
    <>
      {shoppingSeed.map((item) => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.headerRow}>
            <Text style={[styles.name, item.checked && styles.checked]}>{item.name}</Text>
            <Text style={[styles.priority, { color: PRIORITY_COLOR[item.priority] }]}>{item.priority}</Text>
          </View>
          <Text style={styles.meta}>
            {item.quantity} · {item.category}
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
      <TextInput placeholder="Item" value={name} onChangeText={setName} style={inputStyle} />
      <TextInput
        placeholder="Quantity (optional)"
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        style={inputStyle}
      />
      <Text style={styles.fieldLabel}>Unit (optional)</Text>
      <ChipSelect options={[NO_UNIT, ...UNIT_OPTIONS] as const} value={unit} onChange={setUnit} />
      {error && <Text style={styles.error}>{error}</Text>}
      <AppButton title={submitting ? 'Adding…' : 'Add to list'} onPress={handleSubmit} disabled={submitting} />
    </View>
  );
}

function RealShoppingList({ entries, onChanged }: { entries: GroceryListEntryRow[]; onChanged: () => void }) {
  if (entries.length === 0) {
    return <Text style={styles.meta}>Your shopping list is empty.</Text>;
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
            <Text style={styles.remove}>Remove</Text>
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
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Shopping List</Text>
        <DemoShoppingList />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Shopping List</Text>
      {membership === 'loading' && <ActivityIndicator color={color.primary} />}
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
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground, marginBottom: 8 },
  itemCard: { ...cardStyle, padding: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  checked: { textDecorationLine: 'line-through', color: color.mutedForeground },
  priority: { fontFamily: font.semibold, fontSize: 13 },
  cost: { fontFamily: font.bold, marginTop: 4, color: color.foreground },
  addForm: { ...cardStyle, padding: 16, gap: 10 },
  addFormTitle: { fontSize: 15, fontFamily: font.bold, color: color.foreground },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium, marginBottom: -4 },
  error: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
  entryRow: {
    ...cardStyle,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  entryTouchable: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  entryName: { flexShrink: 1, fontFamily: font.regular, color: color.foreground },
  remove: { color: color.destructive, fontFamily: font.medium },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: color.border },
  checkboxChecked: { backgroundColor: color.primary, borderColor: color.primary },
});
