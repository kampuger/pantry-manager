import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, Modal } from 'react-native';
import {
  formatPHP,
  resolveNotifyThreshold,
  computeWastedValue,
  type HouseholdNotifyDefaults,
  type MovementLogRecord,
} from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus, formatExpiryDate } from '@pantry/ui';
import { getHouseholdNotificationPrefs, type Database } from '@pantry/supabase-client';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { color, cardStyle, radius, font } from '../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_LABELS: Record<string, string> = {
  FRIDGE: 'Fridge',
  FREEZER: 'Freezer',
  PANTRY: 'Pantry',
  COUNTER: 'Counter',
  OTHER: 'Other',
};

interface DisplayItem {
  id: string;
  location: string;
  name: string;
  quantity: number;
  unit: string;
  expirationDate: string | null;
  cost: number | null;
}

function toDisplayItem(item: PantryItemRow): DisplayItem {
  return {
    id: item.id,
    location: item.storage_location,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expirationDate: item.expiration_date,
    cost: item.purchase_price,
  };
}

interface SplitRow {
  label: string;
  value: number;
  count: number;
  tone: string;
  items: DisplayItem[];
}

function SplitBars({ rows, onSelectRow }: { rows: SplitRow[]; onSelectRow: (row: SplitRow) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View style={{ gap: 14 }}>
      {rows.map((row) => (
        <Pressable key={row.label} onPress={() => row.count > 0 && onSelectRow(row)} disabled={row.count === 0}>
          <View style={styles.splitRow}>
            <Text style={[styles.splitLabel, row.count > 0 && styles.splitLabelLinked]}>
              {row.label} <Text style={styles.splitCount}>({row.count})</Text>
            </Text>
            <Text style={styles.splitValue}>{formatPHP(row.value)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(row.value / max) * 100}%`, backgroundColor: row.tone }]} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ItemListModal({
  title,
  items,
  onClose,
}: {
  title: string | null;
  items: DisplayItem[];
  onClose: () => void;
}) {
  return (
    <Modal visible={title != null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>
              {title} <Text style={styles.modalCount}>({items.length})</Text>
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>
          <ScrollView>
            {items.length === 0 ? (
              <Text style={styles.meta}>No items in this group.</Text>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemRowTop}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemCost}>{item.cost != null ? formatPHP(item.cost) : '—'}</Text>
                  </View>
                  <Text style={styles.itemMeta}>
                    {LOCATION_LABELS[item.location] ?? item.location} · {item.quantity} {item.unit}
                    {item.expirationDate ? ` · Expires: ${formatExpiryDate(item.expirationDate)}` : ''}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function FinancialsScreen() {
  const { session } = useAuth();
  const { membership } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [wastedLogs, setWastedLogs] = useState<MovementLogRecord[]>([]);
  const [wastedItems, setWastedItems] = useState<DisplayItem[]>([]);
  const [notifyPrefs, setNotifyPrefs] = useState<HouseholdNotifyDefaults>({
    notifyDaysProduce: 2,
    notifyDaysNonproduce: 7,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ title: string; items: DisplayItem[] } | null>(null);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    const householdId = membership.householdId;

    supabase
      .from('pantry_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('is_archived', false)
      .then(({ data, error }) => {
        if (error) setLoadError(`Couldn't load your pantry: ${error.message}`);
        else setItems(data ?? []);
      });

    supabase
      .from('inventory_movement_logs')
      .select('event_type, value_delta, pantry_items(id, name, storage_location, quantity, unit, expiration_date)')
      .eq('household_id', householdId)
      .in('event_type', ['EXPIRED', 'SPOILED_DISCARDED'])
      .then(({ data, error }) => {
        if (error) {
          setLoadError(`Couldn't load movement history: ${error.message}`);
          return;
        }
        const rows = data ?? [];
        setWastedLogs(rows.map((row) => ({ eventType: row.event_type, valueDelta: row.value_delta })));
        setWastedItems(
          rows
            .filter((row): row is typeof row & { pantry_items: NonNullable<typeof row.pantry_items> } => !!row.pantry_items)
            .map((row) => ({
              id: row.pantry_items.id,
              location: row.pantry_items.storage_location,
              name: row.pantry_items.name,
              quantity: row.pantry_items.quantity,
              unit: row.pantry_items.unit,
              expirationDate: row.pantry_items.expiration_date,
              // The movement log's own value_delta — the item's price at the
              // moment it was discarded — not its current purchase_price.
              cost: row.value_delta,
            }))
        );
      });

    getHouseholdNotificationPrefs(supabase, householdId).then((prefs) => {
      setNotifyPrefs({ notifyDaysProduce: prefs.notifyDaysProduce, notifyDaysNonproduce: prefs.notifyDaysNonproduce });
    });
  }, [membership]);

  if (!session || !membership || membership === 'loading') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Financial snapshot</Text>
        <Text style={styles.meta}>Loading…</Text>
      </ScrollView>
    );
  }

  const totalValue = items.reduce((sum, item) => sum + (item.purchase_price ?? 0), 0);

  const produceItems = items.filter((i) => i.is_produce);
  const nonProduceItems = items.filter((i) => !i.is_produce);
  const typeRows: SplitRow[] = [
    {
      label: 'Produce',
      value: produceItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: produceItems.length,
      tone: color.primary,
      items: produceItems.map(toDisplayItem),
    },
    {
      label: 'Non-produce',
      value: nonProduceItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: nonProduceItems.length,
      tone: color.secondary,
      items: nonProduceItems.map(toDisplayItem),
    },
  ];

  // Kept as its own bucket rather than folded into "Expiring soon" — an
  // item already past its date but not yet marked Consumed/Discarded is a
  // meaningfully different risk than one merely approaching expiry, and is
  // NOT the same as "Wasted" below (which only counts items actually
  // archived as discarded/expired via the movement log).
  const itemsWithStatus = items.map((item) => {
    const threshold = resolveNotifyThreshold(
      { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
      notifyPrefs
    );
    const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
    return { item, status };
  });
  const expiredItems = itemsWithStatus.filter((x) => x.status === 'expired').map((x) => x.item);
  const warningItems = itemsWithStatus.filter((x) => x.status === 'warning').map((x) => x.item);
  const notExpiringItems = itemsWithStatus
    .filter((x) => x.status === 'good' || x.status === 'unknown')
    .map((x) => x.item);
  const expiryRows: SplitRow[] = [
    {
      label: 'Expired (not yet discarded)',
      value: expiredItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: expiredItems.length,
      tone: color.destructive,
      items: expiredItems.map(toDisplayItem),
    },
    {
      label: 'Expiring soon',
      value: warningItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: warningItems.length,
      tone: color.warning,
      items: warningItems.map(toDisplayItem),
    },
    {
      label: 'Not expiring soon',
      value: notExpiringItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: notExpiringItems.length,
      tone: color.success,
      items: notExpiringItems.map(toDisplayItem),
    },
  ];

  const wastedValue = computeWastedValue(wastedLogs);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Financial snapshot</Text>
      <Text style={styles.subtitle}>
        A running summary of what&apos;s currently in your pantry, and what&apos;s been thrown away. Tap any row to see the items behind it.
      </Text>

      {loadError && <Text style={styles.errorBanner}>{loadError}</Text>}

      <Pressable
        onPress={() => items.length > 0 && setSelected({ title: 'Total pantry value', items: items.map(toDisplayItem) })}
        style={styles.summaryCard}
      >
        <Text style={styles.label}>Total pantry value ({items.length} active items)</Text>
        <Text style={styles.value}>{formatPHP(totalValue)}</Text>
      </Pressable>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>By item type</Text>
        <SplitBars rows={typeRows} onSelectRow={(row) => setSelected({ title: row.label, items: row.items })} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>By expiry status</Text>
        <SplitBars rows={expiryRows} onSelectRow={(row) => setSelected({ title: row.label, items: row.items })} />
      </View>

      <Pressable
        onPress={() => wastedItems.length > 0 && setSelected({ title: 'Wasted', items: wastedItems })}
        style={styles.wastedCard}
      >
        <Text style={styles.wastedLabel}>
          Wasted (lifetime — {wastedLogs.length} expired/discarded item{wastedLogs.length === 1 ? '' : 's'})
        </Text>
        <Text style={styles.wastedValue}>{formatPHP(wastedValue)}</Text>
      </Pressable>

      <ItemListModal
        title={selected?.title ?? null}
        items={selected?.items ?? []}
        onClose={() => setSelected(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground },
  subtitle: { fontSize: 13, color: color.mutedForeground, fontFamily: font.regular, marginTop: -8 },
  meta: { color: color.mutedForeground, fontSize: 14, fontFamily: font.regular },
  errorBanner: {
    backgroundColor: color.destructiveBg,
    borderWidth: 1,
    borderColor: color.destructive,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    color: color.destructive,
    fontSize: 13,
    fontFamily: font.regular,
  },
  summaryCard: { ...cardStyle, padding: 20 },
  label: { color: color.mutedForeground, fontSize: 12, fontFamily: font.medium },
  value: { marginTop: 8, fontSize: 28, fontFamily: font.bold, color: color.foreground },
  panel: { ...cardStyle, padding: 16, gap: 14 },
  panelTitle: { fontSize: 16, fontFamily: font.bold, color: color.foreground },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  splitLabel: { fontSize: 14, fontFamily: font.regular, color: color.foreground },
  splitLabelLinked: { textDecorationLine: 'underline', textDecorationColor: color.border },
  splitCount: { color: color.mutedForeground, fontFamily: font.regular, fontSize: 13, textDecorationLine: 'none' },
  splitValue: { fontFamily: font.bold, color: color.foreground },
  barTrack: { backgroundColor: color.muted, borderRadius: 999, height: 8, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: 999 },
  wastedCard: {
    ...cardStyle,
    padding: 20,
    backgroundColor: color.destructiveBg,
    borderColor: color.destructive,
  },
  wastedLabel: { color: color.destructive, fontSize: 12, fontFamily: font.medium },
  wastedValue: { marginTop: 8, fontSize: 24, fontFamily: font.bold, color: color.destructive },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { ...cardStyle, backgroundColor: color.card, padding: 20, maxHeight: '80%', gap: 12 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontFamily: font.bold, color: color.foreground },
  modalCount: { color: color.mutedForeground, fontFamily: font.medium, fontSize: 13 },
  modalClose: { fontSize: 16, color: color.mutedForeground, padding: 4 },
  itemRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.border },
  itemRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { fontSize: 14, fontFamily: font.semibold, color: color.foreground, flexShrink: 1, marginRight: 8 },
  itemCost: { fontSize: 14, fontFamily: font.bold, color: color.foreground },
  itemMeta: { fontSize: 12, color: color.mutedForeground, fontFamily: font.regular, marginTop: 2 },
});
