import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatPHP,
  resolveNotifyThreshold,
  computeWastedValue,
  type HouseholdNotifyDefaults,
  type MovementLogRecord,
} from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus } from '@pantry/ui';
import { getHouseholdNotificationPrefs, type Database } from '@pantry/supabase-client';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { color, cardStyle, font } from '../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

interface SplitRow {
  label: string;
  value: number;
  count: number;
  tone: string;
}

function SplitBars({ rows }: { rows: SplitRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View style={{ gap: 14 }}>
      {rows.map((row) => (
        <View key={row.label}>
          <View style={styles.splitRow}>
            <Text style={styles.splitLabel}>
              {row.label} <Text style={styles.splitCount}>({row.count})</Text>
            </Text>
            <Text style={styles.splitValue}>{formatPHP(row.value)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(row.value / max) * 100}%`, backgroundColor: row.tone }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function FinancialsScreen() {
  const { session } = useAuth();
  const { membership } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [wastedLogs, setWastedLogs] = useState<MovementLogRecord[]>([]);
  const [notifyPrefs, setNotifyPrefs] = useState<HouseholdNotifyDefaults>({
    notifyDaysProduce: 2,
    notifyDaysNonproduce: 7,
  });
  const [loadError, setLoadError] = useState<string | null>(null);

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
      .select('event_type, value_delta')
      .eq('household_id', householdId)
      .in('event_type', ['EXPIRED', 'SPOILED_DISCARDED'])
      .then(({ data, error }) => {
        if (error) setLoadError(`Couldn't load movement history: ${error.message}`);
        else setWastedLogs((data ?? []).map((row) => ({ eventType: row.event_type, valueDelta: row.value_delta })));
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
    },
    {
      label: 'Non-produce',
      value: nonProduceItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: nonProduceItems.length,
      tone: color.secondary,
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
    },
    {
      label: 'Expiring soon',
      value: warningItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: warningItems.length,
      tone: color.warning,
    },
    {
      label: 'Not expiring soon',
      value: notExpiringItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0),
      count: notExpiringItems.length,
      tone: color.success,
    },
  ];

  const wastedValue = computeWastedValue(wastedLogs);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Financial snapshot</Text>
      <Text style={styles.subtitle}>A running summary of what&apos;s currently in your pantry, and what&apos;s been thrown away.</Text>

      {loadError && <Text style={styles.errorBanner}>{loadError}</Text>}

      <View style={styles.summaryCard}>
        <Text style={styles.label}>Total pantry value ({items.length} active items)</Text>
        <Text style={styles.value}>{formatPHP(totalValue)}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>By item type</Text>
        <SplitBars rows={typeRows} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>By expiry status</Text>
        <SplitBars rows={expiryRows} />
      </View>

      <View style={styles.wastedCard}>
        <Text style={styles.wastedLabel}>Wasted (lifetime — expired/discarded items)</Text>
        <Text style={styles.wastedValue}>{formatPHP(wastedValue)}</Text>
      </View>
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
  splitCount: { color: color.mutedForeground, fontFamily: font.regular, fontSize: 13 },
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
});
