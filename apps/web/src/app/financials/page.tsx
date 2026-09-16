'use client';

import { useEffect, useState } from 'react';
import {
  formatPHP,
  resolveNotifyThreshold,
  computeWastedValue,
  type HouseholdNotifyDefaults,
  type MovementLogRecord,
} from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus } from '@pantry/ui';
import { getHouseholdNotificationPrefs, type Database } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { color, cardStyle } from '@/lib/theme';

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
    <div style={{ display: 'grid', gap: 14 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
            <span>
              {row.label} <span style={{ color: color.mutedForeground }}>({row.count})</span>
            </span>
            <strong>{formatPHP(row.value)}</strong>
          </div>
          <div style={{ background: color.muted, borderRadius: 999, height: 8, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(row.value / max) * 100}%`,
                background: row.tone,
                height: '100%',
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FinancialsPage() {
  const { session, loading: authLoading } = useAuth();
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

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Financial snapshot</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          Viewing demo data —{' '}
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            sign in
          </a>{' '}
          to see your household&apos;s real numbers.
        </p>
      </div>
    );
  }

  if (!membership || membership === 'loading') {
    return <p style={{ color: color.mutedForeground }}>Loading…</p>;
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

  // "Expiring soon" matches the same Warning+Expired grouping as the
  // Pantry page's own filter, for consistent terminology across the app.
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
    <div>
      <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Financial snapshot</h1>
      <p style={{ margin: '4px 0 0', fontSize: 14, color: color.mutedForeground }}>
        A running summary of what&apos;s currently in your pantry, and what&apos;s been thrown away.
      </p>

      {loadError && (
        <p style={{ ...cardStyle, boxShadow: 'none', background: color.destructiveBg, borderColor: color.destructive, marginTop: 16, padding: '12px 16px', color: color.destructive, fontSize: 13 }}>
          {loadError}
        </p>
      )}

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560 }}>
        <div style={{ color: color.mutedForeground, fontSize: 13 }}>Total pantry value ({items.length} active items)</div>
        <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{formatPHP(totalValue)}</div>
      </div>

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>By item type</h2>
        <div style={{ marginTop: 16 }}>
          <SplitBars rows={typeRows} />
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>By expiry status</h2>
        <div style={{ marginTop: 16 }}>
          <SplitBars rows={expiryRows} />
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560, background: color.destructiveBg, borderColor: color.destructive }}>
        <div style={{ color: color.destructive, fontSize: 13 }}>
          Wasted (lifetime — {wastedLogs.length} expired/discarded item{wastedLogs.length === 1 ? '' : 's'})
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8, color: color.destructive }}>{formatPHP(wastedValue)}</div>
      </div>
    </div>
  );
}
