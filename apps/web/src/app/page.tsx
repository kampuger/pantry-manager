'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resolveNotifyThreshold, formatPHP, type HouseholdNotifyDefaults } from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus } from '@pantry/ui';
import { getHouseholdNotificationPrefs, STORAGE_LOCATION_OPTIONS, type Database } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { color, cardStyle, buttonStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
};

type Granularity = 'daily' | 'weekly' | 'monthly';
const BUCKET_COUNT = 5;

// Every date computation here stays in UTC-midnight terms to match
// daysUntil()/formatExpiryDate()'s own convention (see packages/ui) — mixing
// in local-timezone Date math would make bucket boundaries drift by a day
// for anyone not sitting at UTC.
function addUtcDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function shortUtcDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildBucketLabels(granularity: Granularity, todayUtc: Date): string[] {
  if (granularity === 'daily') {
    return Array.from({ length: BUCKET_COUNT }, (_, i) => {
      if (i === 0) return 'Today';
      if (i === 1) return 'Tomorrow';
      return shortUtcDate(addUtcDays(todayUtc, i));
    });
  }
  if (granularity === 'weekly') {
    return Array.from({ length: BUCKET_COUNT }, (_, i) =>
      i === 0 ? 'This week' : `Wk of ${shortUtcDate(addUtcDays(todayUtc, i * 7))}`
    );
  }
  return Array.from({ length: BUCKET_COUNT }, (_, i) => {
    const monthDate = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() + i, 1));
    const label = monthDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return monthDate.getUTCFullYear() === todayUtc.getUTCFullYear()
      ? label
      : `${label} '${String(monthDate.getUTCFullYear()).slice(2)}`;
  });
}

interface ExpiryBucket {
  label: string;
  count: number;
}

// Forward-looking only (already-expired items are covered by the "Expiring/
// Expired Items" KPI card above) — buckets 0..4 cover the next 5 days, 5
// weeks, or 5 months depending on granularity.
function buildExpiryBuckets(items: PantryItemRow[], granularity: Granularity): ExpiryBucket[] {
  const todayUtc = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const currentMonthIndex = todayUtc.getUTCFullYear() * 12 + todayUtc.getUTCMonth();
  const counts = Array(BUCKET_COUNT).fill(0);

  for (const item of items) {
    const days = daysUntil(item.expiration_date);
    if (days === null || days < 0) continue;

    let bucketIndex: number | null = null;
    if (granularity === 'daily') {
      if (days < BUCKET_COUNT) bucketIndex = days;
    } else if (granularity === 'weekly') {
      const week = Math.floor(days / 7);
      if (week < BUCKET_COUNT) bucketIndex = week;
    } else {
      const expDate = new Date(`${item.expiration_date!.slice(0, 10)}T00:00:00Z`);
      const diff = expDate.getUTCFullYear() * 12 + expDate.getUTCMonth() - currentMonthIndex;
      if (diff >= 0 && diff < BUCKET_COUNT) bucketIndex = diff;
    }
    if (bucketIndex !== null) counts[bucketIndex]++;
  }

  const labels = buildBucketLabels(granularity, todayUtc);
  return counts.map((count, i) => ({ label: labels[i], count }));
}

function ExpiryChart({ items }: { items: PantryItemRow[] }) {
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const buckets = buildExpiryBuckets(items, granularity);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const isEmpty = buckets.every((b) => b.count === 0);

  return (
    <section style={{ ...cardStyle, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Items expiring soon</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['daily', 'weekly', 'monthly'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              style={{ ...buttonStyle(granularity === g ? 'primary' : 'secondary'), padding: '6px 14px', fontSize: 13 }}
            >
              {g === 'daily' ? 'Daily' : g === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 160, marginTop: 24, padding: '0 4px' }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.label}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: color.foreground }}>{bucket.count}</span>
            <div
              style={{
                width: '100%',
                maxWidth: 48,
                height: `${Math.max((bucket.count / max) * 100, bucket.count > 0 ? 6 : 2)}%`,
                background: bucket.count > 0 ? color.accent : color.border,
                borderRadius: '6px 6px 0 0',
                transition: 'height 200ms ease',
              }}
            />
            <span style={{ fontSize: 11, color: color.mutedForeground, textAlign: 'center', whiteSpace: 'nowrap' }}>
              {bucket.label}
            </span>
          </div>
        ))}
      </div>

      {isEmpty && (
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: color.mutedForeground }}>
          Nothing expiring in this window.
        </p>
      )}
    </section>
  );
}

interface LocationSummaryRow {
  location: string;
  icon: string;
  label: string;
  count: number;
  cost: number;
}

function buildLocationSummary(items: PantryItemRow[]): LocationSummaryRow[] {
  const byLocation = new Map<string, PantryItemRow[]>();
  for (const item of items) {
    const bucket = byLocation.get(item.storage_location) ?? [];
    bucket.push(item);
    byLocation.set(item.storage_location, bucket);
  }

  return STORAGE_LOCATION_OPTIONS.filter((location) => byLocation.has(location)).map((location) => {
    const groupItems = byLocation.get(location)!;
    const meta = LOCATION_META[location] ?? { icon: '📦', label: location };
    return {
      location,
      icon: meta.icon,
      label: meta.label,
      count: groupItems.length,
      cost: groupItems.reduce((sum, item) => sum + (item.purchase_price ?? 0), 0),
    };
  });
}

function LocationSummary({ items }: { items: PantryItemRow[] }) {
  const rows = buildLocationSummary(items);
  const maxCost = Math.max(1, ...rows.map((r) => r.cost));

  return (
    <section style={{ ...cardStyle, padding: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Pantry summary by location</h2>
      {rows.length === 0 ? (
        <p style={{ color: color.mutedForeground, fontSize: 14, margin: 0 }}>No active items yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginTop: 6 }}>
          {rows.map((row) => (
            <div key={row.location}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
                <span>
                  {row.icon} {row.label}{' '}
                  <span style={{ color: color.mutedForeground }}>
                    ({row.count} item{row.count === 1 ? '' : 's'})
                  </span>
                </span>
                <strong>{formatPHP(row.cost)}</strong>
              </div>
              <div style={{ background: color.muted, borderRadius: 999, height: 8, overflow: 'hidden' }}>
                <div
                  style={{ width: `${(row.cost / maxCost) * 100}%`, background: color.primary, height: '100%', borderRadius: 999 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const { session, loading: authLoading } = useAuth();
  const { membership, create, join } = useHousehold();
  const router = useRouter();
  const [items, setItems] = useState<PantryItemRow[]>([]);
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

    getHouseholdNotificationPrefs(supabase, householdId).then((prefs) => {
      setNotifyPrefs({ notifyDaysProduce: prefs.notifyDaysProduce, notifyDaysNonproduce: prefs.notifyDaysNonproduce });
    });
  }, [membership]);

  const header = (
    <header>
      <p style={{ margin: 0, color: color.mutedForeground, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        Overview
      </p>
      <h1 style={{ margin: '6px 0 0' }}>Dashboard</h1>
    </header>
  );

  // The login page is this app's default landing experience — a signed-out
  // visitor to "/" is sent straight there instead of seeing a limited demo
  // dashboard.
  useEffect(() => {
    if (!authLoading && !session) router.replace('/login');
  }, [authLoading, session, router]);

  if (authLoading || !session) return null;

  if (membership === 'loading') {
    return <p style={{ color: color.mutedForeground }}>Loading…</p>;
  }

  if (membership === null) {
    return (
      <div>
        {header}
        <CreateHouseholdPrompt onCreate={create} onJoin={join} />
      </div>
    );
  }

  const overallCost = items.reduce((sum, item) => sum + (item.purchase_price ?? 0), 0);

  const expiringOrExpiredCount = items.filter((item) => {
    const threshold = resolveNotifyThreshold(
      { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
      notifyPrefs
    );
    const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
    return status === 'warning' || status === 'expired';
  }).length;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {header}

      {loadError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{loadError}</p>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {[
          { label: 'Pantry Items', value: String(items.length) },
          { label: 'Expiring/Expired Items', value: String(expiringOrExpiredCount) },
          { label: 'Overall Cost', value: formatPHP(overallCost) },
        ].map((card) => (
          <div key={card.label} style={{ ...cardStyle, padding: 20 }}>
            <div style={{ color: color.mutedForeground, fontSize: 13 }}>{card.label}</div>
            <div style={{ marginTop: 8, fontSize: 26, fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </section>

      <ExpiryChart items={items} />

      <LocationSummary items={items} />
    </div>
  );
}
