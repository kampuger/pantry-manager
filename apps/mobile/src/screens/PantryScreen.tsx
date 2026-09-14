import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, ActivityIndicator, Pressable } from 'react-native';
import { getFreshnessFlag } from '@pantry/core';
import { groupItemsByLocation } from '@pantry/ui';
import {
  addPantryItem,
  updatePantryItem,
  archivePantryItem,
  STORAGE_LOCATION_OPTIONS,
  type Database,
} from '@pantry/supabase-client';
import { pantrySeed } from '../data/seed';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { CreateHouseholdPrompt } from '../components/CreateHouseholdPrompt';
import { Badge } from '../components/Badge';
import { ItemForm, type ItemFormValues } from '../components/pantry/ItemForm';
import { PantryLocationGroup } from '../components/pantry/PantryLocationGroup';
import { NotificationPrefsModal } from '../components/pantry/NotificationPrefsModal';
import { color, cardStyle, font } from '../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
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

export function PantryScreen() {
  const { session } = useAuth();
  const { membership, create } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [editingItem, setEditingItem] = useState<PantryItemRow | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

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

  async function handleAdd(values: ItemFormValues) {
    if (!membership || membership === 'loading') return;
    await addPantryItem(supabase, membership.householdId, session!.user.id, {
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      storageLocation: values.storageLocation,
      isProduce: values.isProduce,
      expirationDate: values.expirationDate,
      notifyDaysBeforeExpiry: values.notifyDaysOverride,
    });
    refreshItems(membership.householdId);
  }

  async function handleEditSave(values: ItemFormValues) {
    if (!editingItem || !membership || membership === 'loading') return;
    await updatePantryItem(supabase, editingItem.id, {
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      storageLocation: values.storageLocation,
      isProduce: values.isProduce,
      expirationDate: values.expirationDate,
      notifyDaysBeforeExpiry: values.notifyDaysOverride,
    });
    setEditingItem(null);
    refreshItems(membership.householdId);
  }

  async function handleArchive(item: PantryItemRow, eventType: 'CONSUMED' | 'SPOILED_DISCARDED') {
    if (!membership || membership === 'loading') return;
    await archivePantryItem(supabase, {
      itemId: item.id,
      householdId: membership.householdId,
      quantity: item.quantity,
      eventType,
      userId: session!.user.id,
    });
    refreshItems(membership.householdId);
  }

  const groups = groupItemsByLocation(
    items.map((item) => ({
      id: item.id,
      storageLocation: item.storage_location,
      daysUntilExpiry: daysUntil(item.expiration_date),
    })),
    STORAGE_LOCATION_OPTIONS
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.topHeaderRow}>
        <Text style={styles.title}>Pantry Inventory</Text>
        {membership && membership !== 'loading' && (
          <Pressable onPress={() => setShowPrefs(true)}>
            <Text style={styles.gearIcon}>⚙️</Text>
          </Pressable>
        )}
      </View>
      {membership === 'loading' && <ActivityIndicator color={color.primary} />}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          {editingItem ? (
            <ItemForm
              submitLabel="Save changes"
              onCancel={() => setEditingItem(null)}
              initialValues={{
                name: editingItem.name,
                quantity: editingItem.quantity,
                unit: editingItem.unit,
                storageLocation: editingItem.storage_location,
                isProduce: editingItem.is_produce,
                expirationDate: editingItem.expiration_date,
                notifyDaysOverride: editingItem.notify_days_before_expiry,
                purchaseDate: editingItem.purchase_date,
              }}
              onSubmit={handleEditSave}
            />
          ) : (
            <ItemForm submitLabel="Add item" onSubmit={handleAdd} />
          )}
          {items.length === 0 && <Text style={styles.meta}>No pantry items yet.</Text>}
          {groups.map((group) => (
            <PantryLocationGroup
              key={group.location}
              icon={LOCATION_META[group.location].icon}
              label={LOCATION_META[group.location].label}
              expiringSoonCount={group.expiringSoonCount}
              items={items.filter((item) => group.itemIds.includes(item.id))}
              onEdit={setEditingItem}
              onConsumed={(item) => handleArchive(item, 'CONSUMED')}
              onExpired={(item) => handleArchive(item, 'SPOILED_DISCARDED')}
            />
          ))}
          <NotificationPrefsModal
            householdId={membership.householdId}
            visible={showPrefs}
            onClose={() => setShowPrefs(false)}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 12 },
  topHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gearIcon: { fontSize: 20 },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground, marginBottom: 8 },
  itemCard: { ...cardStyle, padding: 16, gap: 6 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
});
