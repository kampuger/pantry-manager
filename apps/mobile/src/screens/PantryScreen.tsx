import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Button, ActivityIndicator, Pressable } from 'react-native';
import { getFreshnessFlag } from '@pantry/core';
import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import {
  getMyHousehold,
  createHousehold,
  addPantryItem,
  UNIT_OPTIONS,
  STORAGE_LOCATION_OPTIONS,
  type HouseholdMembership,
  type Database,
} from '@pantry/supabase-client';
import { pantrySeed } from '../data/seed';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const BADGE_STYLES: Record<ExpiryBadgeStatus, { background: string; color: string }> = {
  critical: { background: '#fee2e2', color: '#b91c1c' },
  warning: { background: '#fef3c7', color: '#92400e' },
  ok: { background: '#dcfce7', color: '#166534' },
  unknown: { background: '#e2e8f0', color: '#475569' },
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

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{item.name}</Text>
              <Text
                style={[
                  styles.badge,
                  {
                    backgroundColor: flagged ? '#fee2e2' : item.status === 'low' ? '#fef3c7' : '#dcfce7',
                    color: flagged ? '#b91c1c' : item.status === 'low' ? '#92400e' : '#166534',
                  },
                ]}
              >
                {flagged ? 'flagged' : item.status}
              </Text>
            </View>
            <Text>
              {item.quantity} {item.unit}
            </Text>
            <Text>
              {item.location} • {item.category}
            </Text>
            <Text>Last restock: {new Date(item.lastRestock).toLocaleDateString()}</Text>
            <Text>Expires: {item.expiry}</Text>
          </View>
        );
      })}
    </>
  );
}

function CreateHouseholdForm({ userId, onCreated }: { userId: string; onCreated: (m: HouseholdMembership) => void }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const membership = await createHousehold(supabase, userId, name.trim() || 'My Household');
      onCreated(membership);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text>You&apos;re signed in, but not part of a household yet.</Text>
      <TextInput
        placeholder="Household name"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      {error && <Text style={{ color: '#b91c1c' }}>{error}</Text>}
      <Button title={submitting ? 'Creating…' : 'Create household'} onPress={handleSubmit} disabled={submitting} />
    </View>
  );
}

function ChipSelect<T extends string>({
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
      <TextInput placeholder="Name" value={name} onChangeText={setName} style={styles.input} />
      <TextInput
        placeholder="Quantity"
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>Unit</Text>
      <ChipSelect options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
      <Text style={styles.fieldLabel}>Storage</Text>
      <ChipSelect options={STORAGE_LOCATION_OPTIONS} value={storageLocation} onChange={setStorageLocation} />
      {error && <Text style={{ color: '#b91c1c' }}>{error}</Text>}
      <Button title={submitting ? 'Adding…' : 'Add item'} onPress={handleSubmit} disabled={submitting} />
    </View>
  );
}

function RealPantryList({ items }: { items: PantryItemRow[] }) {
  if (items.length === 0) {
    return <Text style={{ color: '#64748b' }}>No pantry items yet.</Text>;
  }

  return (
    <>
      {items.map((item) => {
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
        const badge = BADGE_STYLES[status];

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={[styles.badge, { backgroundColor: badge.background, color: badge.color }]}>{status}</Text>
            </View>
            <Text>
              {item.quantity} {item.unit}
            </Text>
            <Text>{item.storage_location}</Text>
            {item.expiration_date && <Text>Expires: {item.expiration_date}</Text>}
          </View>
        );
      })}
    </>
  );
}

export function PantryScreen() {
  const { session } = useAuth();
  const [membership, setMembership] = useState<HouseholdMembership | null | 'loading'>('loading');
  const [items, setItems] = useState<PantryItemRow[]>([]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    setMembership('loading');

    getMyHousehold(supabase, session.user.id).then((result) => {
      if (!cancelled) setMembership(result);
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

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
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Pantry Inventory</Text>
        <DemoPantryList />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Pantry Inventory</Text>
      {membership === 'loading' && <ActivityIndicator />}
      {membership === null && <CreateHouseholdForm userId={session.user.id} onCreated={setMembership} />}
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
  container: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12 },
  itemCard: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '600' },
  badge: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, textTransform: 'capitalize' },
  addForm: { borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  addFormTitle: { fontSize: 16, fontWeight: '700' },
  fieldLabel: { fontSize: 12, color: '#64748b', marginBottom: -4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#334155' },
  chipTextSelected: { fontSize: 13, color: '#fff', fontWeight: '600' },
});
