'use client';

import { useEffect, useState } from 'react';
import {
  formatPHP,
  resolveNotifyThreshold,
  computeWastedValue,
  type HouseholdNotifyDefaults,
  type MovementLogRecord,
} from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus, formatExpiryDate } from '@pantry/ui';
import { getHouseholdNotificationPrefs, type Database } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { useIsMobile } from '@/lib/useIsMobile';
import { color, cardStyle, radius } from '@/lib/theme';

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
    <div style={{ display: 'grid', gap: 14 }}>
      {rows.map((row) => (
        <button
          key={row.label}
          onClick={() => onSelectRow(row)}
          disabled={row.count === 0}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: 0,
            fontFamily: 'inherit',
            cursor: row.count === 0 ? 'default' : 'pointer',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
            <span style={{ color: color.foreground, textDecorationLine: row.count > 0 ? 'underline' : 'none', textDecorationColor: color.border }}>
              {row.label} <span style={{ color: color.mutedForeground, textDecorationLine: 'none' }}>({row.count})</span>
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
        </button>
      ))}
    </div>
  );
}

function ItemListModal({
  title,
  items,
  onClose,
}: {
  title: string;
  items: DisplayItem[];
  onClose: () => void;
}) {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      <div style={{ ...cardStyle, padding: 24, width: '100%', maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {title} <span style={{ color: color.mutedForeground, fontWeight: 500, fontSize: 14 }}>({items.length})</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: color.mutedForeground }}
          >
            ✕
          </button>
        </div>
        {items.length === 0 ? (
          <p style={{ color: color.mutedForeground, fontSize: 14 }}>No items in this group.</p>
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map((item) => (
              <div key={item.id} style={{ borderBottom: `1px solid ${color.border}`, paddingBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
                    {item.cost != null ? formatPHP(item.cost) : '—'}
                  </span>
                </div>
                <div style={{ color: color.mutedForeground, fontSize: 12.5, marginTop: 2 }}>
                  {LOCATION_LABELS[item.location] ?? item.location} · {item.quantity} {item.unit}
                  {item.expirationDate ? ` · ${formatExpiryDate(item.expirationDate)}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Location</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Item</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Quantity</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Expiration</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600, textAlign: 'right' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${color.border}` }}>
                    <td style={{ padding: '10px' }}>{LOCATION_LABELS[item.location] ?? item.location}</td>
                    <td style={{ padding: '10px', fontWeight: 600 }}>{item.name}</td>
                    <td style={{ padding: '10px' }}>
                      {item.quantity} {item.unit}
                    </td>
                    <td style={{ padding: '10px' }}>
                      {item.expirationDate ? formatExpiryDate(item.expirationDate) : '—'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      {item.cost != null ? formatPHP(item.cost) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              background: color.muted,
              color: color.foreground,
              border: `1px solid ${color.border}`,
              borderRadius: radius.sm,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FinancialsPage() {
  const { session, loading: authLoading } = useAuth();
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
              // moment it was discarded — not its current purchase_price,
              // which is a more historically accurate "wasted" figure.
              cost: row.value_delta,
            }))
        );
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
    <div>
      <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Financial snapshot</h1>
      <p style={{ margin: '4px 0 0', fontSize: 14, color: color.mutedForeground }}>
        A running summary of what&apos;s currently in your pantry, and what&apos;s been thrown away. Click any row to see the items behind it.
      </p>

      {loadError && (
        <p style={{ ...cardStyle, boxShadow: 'none', background: color.destructiveBg, borderColor: color.destructive, marginTop: 16, padding: '12px 16px', color: color.destructive, fontSize: 13 }}>
          {loadError}
        </p>
      )}

      <button
        onClick={() => items.length > 0 && setSelected({ title: 'Total pantry value', items: items.map(toDisplayItem) })}
        disabled={items.length === 0}
        style={{
          ...cardStyle,
          display: 'block',
          width: '100%',
          textAlign: 'left',
          marginTop: 20,
          padding: 24,
          maxWidth: 560,
          background: color.card,
          border: `1px solid ${color.border}`,
          cursor: items.length === 0 ? 'default' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ color: color.mutedForeground, fontSize: 13 }}>Total pantry value ({items.length} active items)</div>
        <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8, color: color.foreground }}>{formatPHP(totalValue)}</div>
      </button>

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>By item type</h2>
        <div style={{ marginTop: 16 }}>
          <SplitBars rows={typeRows} onSelectRow={(row) => setSelected({ title: row.label, items: row.items })} />
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>By expiry status</h2>
        <div style={{ marginTop: 16 }}>
          <SplitBars rows={expiryRows} onSelectRow={(row) => setSelected({ title: row.label, items: row.items })} />
        </div>
      </div>

      <button
        onClick={() => wastedItems.length > 0 && setSelected({ title: 'Wasted', items: wastedItems })}
        disabled={wastedItems.length === 0}
        style={{
          ...cardStyle,
          display: 'block',
          width: '100%',
          textAlign: 'left',
          marginTop: 20,
          padding: 24,
          maxWidth: 560,
          background: color.destructiveBg,
          border: `1px solid ${color.destructive}`,
          cursor: wastedItems.length === 0 ? 'default' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ color: color.destructive, fontSize: 13 }}>
          Wasted (lifetime — {wastedLogs.length} expired/discarded item{wastedLogs.length === 1 ? '' : 's'})
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8, color: color.destructive }}>{formatPHP(wastedValue)}</div>
      </button>

      {selected && (
        <ItemListModal title={selected.title} items={selected.items} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
