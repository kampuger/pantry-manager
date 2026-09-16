import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, ActivityIndicator, Pressable } from 'react-native';
import { getFreshnessFlag, resolveNotifyThreshold, type HouseholdNotifyDefaults } from '@pantry/core';
import { daysUntil, groupItemsByLocation } from '@pantry/ui';
import {
  addPantryItem,
  updatePantryItem,
  archivePantryItem,
  getHouseholdNotificationPrefs,
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
import { color, radius, cardStyle, font } from '../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
};

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
  const [screenError, setScreenError] = useState<string | null>(null);
  // Seeded with the households table's own defaults so the first paint
  // (before the fetch below resolves) already matches what a fresh
  // household would have — avoids a flash of an arbitrary threshold.
  const [notifyPrefs, setNotifyPrefs] = useState<HouseholdNotifyDefaults>({
    notifyDaysProduce: 2,
    notifyDaysNonproduce: 7,
  });

  const refreshItems = useCallback(
    (householdId: string) =>
      supabase
        .from('pantry_items')
        .select('*')
        .eq('household_id', householdId)
        .eq('is_archived', false)
        // Soonest-expiring first within each location group; undated items last.
        .order('expiration_date', { ascending: true, nullsFirst: false })
        .then(({ data, error }) => {
          if (error) {
            setScreenError(`Couldn't load your pantry: ${error.message}`);
            return;
          }
          setScreenError(null);
          setItems(data ?? []);
        }),
    []
  );

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    refreshItems(membership.householdId);
  }, [membership, refreshItems]);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    getHouseholdNotificationPrefs(supabase, membership.householdId).then((prefs) => {
      setNotifyPrefs({ notifyDaysProduce: prefs.notifyDaysProduce, notifyDaysNonproduce: prefs.notifyDaysNonproduce });
    });
  }, [membership]);

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
    await refreshItems(membership.householdId);
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
    await refreshItems(membership.householdId);
  }

  // Called as a floating promise from the card actions, so it swallows its own
  // errors into the screen banner rather than rejecting into nothing.
  async function handleArchive(item: PantryItemRow, eventType: 'CONSUMED' | 'SPOILED_DISCARDED') {
    if (!membership || membership === 'loading') return;
    try {
      setScreenError(null);
      await archivePantryItem(supabase, {
        itemId: item.id,
        householdId: membership.householdId,
        quantity: item.quantity,
        eventType,
        userId: session!.user.id,
      });
      await refreshItems(membership.householdId);
    } catch (err) {
      setScreenError(
        err instanceof Error ? `Couldn't update ${item.name}: ${err.message}` : `Couldn't update ${item.name}.`
      );
    }
  }

  const groups = groupItemsByLocation(
    items.map((item) => ({
      id: item.id,
      storageLocation: item.storage_location,
      daysUntilExpiry: daysUntil(item.expiration_date),
      warningThresholdDays: resolveNotifyThreshold(
        { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
        notifyPrefs
      ),
    })),
    STORAGE_LOCATION_OPTIONS
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.topHeaderRow}>
        <Text style={styles.title}>Pantry Inventory</Text>
        {membership && membership !== 'loading' && (
          <Pressable
            onPress={() => setShowPrefs(true)}
            style={({ pressed }) => [styles.gearButton, pressed && styles.gearButtonPressed]}
          >
            <Text style={styles.gearIcon}>⚙️</Text>
          </Pressable>
        )}
      </View>
      {membership === 'loading' && <ActivityIndicator color={color.primary} />}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          {/* Both branches sit at the same JSX position, so without a distinct
              `key` React reuses one ItemForm instance and its useState
              initializers never re-run — the edit form would open showing the
              previous render's values and save those over the real item. */}
          {editingItem ? (
            <ItemForm
              key={`edit-${editingItem.id}`}
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
            <ItemForm key="add" submitLabel="Add item" onSubmit={handleAdd} />
          )}
          {screenError && <Text style={styles.errorBanner}>{screenError}</Text>}
          {!screenError && items.length === 0 && (
            <Text style={styles.emptyState}>No pantry items yet.</Text>
          )}
          {groups.map((group) => (
            <PantryLocationGroup
              key={group.location}
              icon={LOCATION_META[group.location].icon}
              label={LOCATION_META[group.location].label}
              expiringSoonCount={group.expiringSoonCount}
              items={items.filter((item) => group.itemIds.includes(item.id))}
              notifyPrefs={notifyPrefs}
              onEdit={setEditingItem}
              onConsumed={(item) => handleArchive(item, 'CONSUMED')}
              onExpired={(item) => handleArchive(item, 'SPOILED_DISCARDED')}
            />
          ))}
          <NotificationPrefsModal
            householdId={membership.householdId}
            isAdmin={membership.role !== 'MEMBER'}
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
  container: { padding: 20, paddingBottom: 40, gap: 14 },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  gearButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearButtonPressed: { backgroundColor: color.muted },
  gearIcon: { fontSize: 18 },
  title: { flexShrink: 1, fontSize: 26, fontFamily: font.bold, color: color.foreground, letterSpacing: -0.5 },
  itemCard: { ...cardStyle, paddingVertical: 14, paddingHorizontal: 16, gap: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  name: { flex: 1, fontSize: 15, lineHeight: 21, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  errorBanner: {
    backgroundColor: color.destructiveBg,
    borderWidth: 1,
    borderColor: color.destructive,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    color: color.destructive,
    fontSize: 13,
    fontFamily: font.regular,
    overflow: 'hidden',
  },
  emptyState: {
    backgroundColor: color.muted,
    borderWidth: 1,
    borderColor: color.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: 24,
    paddingHorizontal: 16,
    textAlign: 'center',
    color: color.mutedForeground,
    fontSize: 13,
    fontFamily: font.regular,
    overflow: 'hidden',
  },
});
