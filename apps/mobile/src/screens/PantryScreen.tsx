import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { getFreshnessFlag } from '@pantry/core';
import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import { addPantryItem, UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS, type Database } from '@pantry/supabase-client';
import { pantrySeed } from '../data/seed';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { CreateHouseholdPrompt } from '../components/CreateHouseholdPrompt';
import { ChipSelect } from '../components/ChipSelect';
import { Badge } from '../components/Badge';
import { AppButton } from '../components/AppButton';
import { color, cardStyle, inputStyle, font } from '../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  critical: 'destructive',
  warning: 'warning',
  ok: 'success',
  unknown: 'muted',
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function DemoPantryList() {
  return (
    <>
      {pantrySeed.map((item) => {
        const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);
        const tone = flagged ? 'destructive' : item.status === 'low' ? 'warning' : 'success';

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{item.name}</Text>
              <Badge tone={tone}>{flagged ? 'flagged' : item.status}</Badge>
            </View>
            <Text style={styles.meta}>
              {item.quantity} {item.unit} · {item.location} · {item.category}
            </Text>
            <Text style={styles.meta}>
              Last restock: {new Date(item.lastRestock).toLocaleDateString()} · Expires: {item.expiry}
            </Text>
          </View>
        );
      })}
    </>
  );
}

function AddItemForm({
  householdId,
  userId,
  onAdded,
}: {
  householdId: string;
  userId: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<string>(UNIT_OPTIONS[0]);
  const [storageLocation, setStorageLocation] = useState<string>(STORAGE_LOCATION_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addPantryItem(supabase, householdId, userId, {
        name: name.trim(),
        quantity: Number(quantity) || 0,
        unit,
        storageLocation,
      });
      setName('');
      setQuantity('1');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.addForm}>
      <Text style={styles.addFormTitle}>Add item</Text>
      <TextInput placeholder="Name" value={name} onChangeText={setName} style={inputStyle} />
      <TextInput
        placeholder="Quantity"
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        style={inputStyle}
      />
      <Text style={styles.fieldLabel}>Unit</Text>
      <ChipSelect options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
      <Text style={styles.fieldLabel}>Storage</Text>
      <ChipSelect options={STORAGE_LOCATION_OPTIONS} value={storageLocation} onChange={setStorageLocation} />
      {error && <Text style={styles.error}>{error}</Text>}
      <AppButton title={submitting ? 'Adding…' : 'Add item'} onPress={handleSubmit} disabled={submitting} />
    </View>
  );
}

function RealPantryList({ items }: { items: PantryItemRow[] }) {
  if (items.length === 0) {
    return <Text style={styles.meta}>No pantry items yet.</Text>;
  }

  return (
    <>
      {items.map((item) => {
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{item.name}</Text>
              <Badge tone={EXPIRY_TONE[status]}>{status}</Badge>
            </View>
            <Text style={styles.meta}>
              {item.quantity} {item.unit} · {item.storage_location}
              {item.expiration_date && ` · Expires ${item.expiration_date}`}
            </Text>
          </View>
        );
      })}
    </>
  );
}

export function PantryScreen() {
  const { session } = useAuth();
  const { membership, create } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);

  const refreshItems = useCallback((householdId: string) => {
    supabase
      .from('pantry_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('is_archived', false)
      .then(({ data }) => setItems(data ?? []));
  }, []);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    refreshItems(membership.householdId);
  }, [membership, refreshItems]);

  // PantryScreen only renders once App.tsx has already confirmed a session
  // exists (see App.tsx's Root component), so `session` is always non-null
  // here in practice — this demo fallback covers the type only.
  if (!session) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Pantry Inventory</Text>
        <DemoPantryList />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Pantry Inventory</Text>
      {membership === 'loading' && <ActivityIndicator color={color.primary} />}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <AddItemForm
            householdId={membership.householdId}
            userId={session.user.id}
            onAdded={() => refreshItems(membership.householdId)}
          />
          <RealPantryList items={items} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground, marginBottom: 8 },
  itemCard: { ...cardStyle, padding: 16, gap: 6 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  addForm: { ...cardStyle, padding: 16, gap: 10 },
  addFormTitle: { fontSize: 15, fontFamily: font.bold, color: color.foreground },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium, marginBottom: -4 },
  error: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
});
