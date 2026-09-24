'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  resolveNotifyThreshold,
  formatPHP,
  buildTimelineBuckets,
  type HouseholdNotifyDefaults,
  type TimelineCategory,
} from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus } from '@pantry/ui';
import {
  getHouseholdNotificationPrefs,
  createHouseholdInvite,
  STORAGE_LOCATION_OPTIONS,
  type Database,
  type HouseholdInvite,
} from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { color, radius, cardStyle, buttonStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
};

type Granularity = 'daily' | 'weekly' | 'monthly';

// Same past/future span regardless of granularity — 3 daily buckets is
// "this week at a glance", 3 weekly is "this month", 3 monthly is "this
// quarter", each a reasonable window for its own zoom level.
const PAST_BUCKETS = 3;
const FUTURE_BUCKETS = 3;

const CATEGORY_ORDER: TimelineCategory[] = ['expiring', 'expired', 'consumed'];
const CATEGORY_META: Record<TimelineCategory, { label: string; color: string }> = {
  expiring: { label: 'Expiring', color: color.accent },
  expired: { label: 'Expired', color: color.destructive },
  consumed: { label: 'Consumed', color: color.success },
};

function formatInviteExpiry(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// How many days back a "Consumed" fetch needs to cover the oldest bucket
// this granularity can show — generously rounded up per unit since it only
// widens the query, never narrows which rows land in a bucket (buildTimelineBuckets
// drops anything outside the actual past/future window regardless).
function consumedLookbackDays(granularity: Granularity): number {
  if (granularity === 'daily') return PAST_BUCKETS;
  if (granularity === 'weekly') return PAST_BUCKETS * 7;
  return PAST_BUCKETS * 31;
}

function ExpiryChart({ items, householdId }: { items: PantryItemRow[]; householdId: string }) {
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [selected, setSelected] = useState<Set<TimelineCategory>>(() => new Set(CATEGORY_ORDER));
  const [consumedDates, setConsumedDates] = useState<string[]>([]);
  const wantsConsumed = selected.has('consumed');

  useEffect(() => {
    if (!wantsConsumed) return;
    const sinceIso = new Date(Date.now() - consumedLookbackDays(granularity) * 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from('inventory_movement_logs')
      .select('occurred_at')
      .eq('household_id', householdId)
      .eq('event_type', 'CONSUMED')
      .gte('occurred_at', sinceIso)
      .then(({ data, error }) => {
        if (!error) setConsumedDates((data ?? []).map((row) => row.occurred_at.slice(0, 10)));
      });
  }, [householdId, granularity, wantsConsumed]);

  const expiringDates: string[] = [];
  const expiredDates: string[] = [];
  for (const item of items) {
    if (!item.expiration_date) continue;
    const days = daysUntil(item.expiration_date);
    if (days === null) continue;
    (days >= 0 ? expiringDates : expiredDates).push(item.expiration_date.slice(0, 10));
  }

  const buckets = buildTimelineBuckets({
    granularity,
    todayIso: new Date().toISOString().slice(0, 10),
    pastBucketCount: PAST_BUCKETS,
    futureBucketCount: FUTURE_BUCKETS,
    dates: { expiring: expiringDates, expired: expiredDates, consumed: consumedDates },
  });

  const activeCategories = CATEGORY_ORDER.filter((c) => selected.has(c));
  const max = Math.max(1, ...buckets.flatMap((b) => activeCategories.map((c) => b.counts[c])));
  const isEmpty = activeCategories.length === 0 || buckets.every((b) => activeCategories.every((c) => b.counts[c] === 0));

  function toggleCategory(category: TimelineCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <section style={{ ...cardStyle, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Pantry timeline</h2>
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

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        {CATEGORY_ORDER.map((category) => {
          const isOn = selected.has(category);
          const meta = CATEGORY_META[category];
          return (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              style={{
                ...buttonStyle('secondary'),
                padding: '5px 12px',
                fontSize: 12,
                borderColor: isOn ? meta.color : color.border,
                color: isOn ? meta.color : color.mutedForeground,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOn ? meta.color : color.border }} />
              {meta.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 160, marginTop: 24, padding: '0 4px', overflowX: 'auto' }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.offset}
            style={{ flex: '0 0 auto', minWidth: 15 * Math.max(activeCategories.length, 1) + 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110 }}>
              {activeCategories.map((category) => {
                const count = bucket.counts[category];
                return (
                  <div key={category} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: color.foreground }}>{count}</span>
                    <div
                      style={{
                        width: 14,
                        height: `${Math.max((count / max) * 100, count > 0 ? 6 : 2)}%`,
                        background: count > 0 ? CATEGORY_META[category].color : color.border,
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 200ms ease',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: bucket.offset === 0 ? 700 : 400,
                color: bucket.offset === 0 ? color.foreground : color.mutedForeground,
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {bucket.label}
            </span>
          </div>
        ))}
      </div>

      {isEmpty && (
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: color.mutedForeground }}>
          {activeCategories.length === 0 ? 'Pick at least one filter above to see the timeline.' : 'Nothing in this window.'}
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<HouseholdInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const canInvite =
    membership !== null && membership !== 'loading' && (membership.role === 'OWNER' || membership.role === 'ADMIN');

  async function handleGenerateInvite() {
    if (!session || membership === null || membership === 'loading') return;
    setGeneratingInvite(true);
    setInviteError(null);
    setCopied(false);
    try {
      setInvite(await createHouseholdInvite(supabase, membership.householdId, session.user.id));
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to generate invite code');
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function handleCopyInviteCode() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      // Clipboard access can be denied by the browser — the code stays
      // visible in the box below for the owner to select and copy by hand.
    }
  }

  const header = (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <p style={{ margin: 0, color: color.mutedForeground, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Overview
        </p>
        <h1 style={{ margin: '6px 0 0' }}>Dashboard</h1>
      </div>

      {canInvite && (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <button onClick={() => setInviteOpen((v) => !v)} style={buttonStyle('secondary')}>
            Invite a member
          </button>
          {inviteOpen && (
            <div style={{ ...cardStyle, padding: 16, display: 'grid', gap: 10, minWidth: 260 }}>
              {inviteError && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{inviteError}</p>}
              {invite ? (
                <>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 18,
                      fontWeight: 700,
                      letterSpacing: 2,
                      padding: '8px 12px',
                      borderRadius: radius.sm,
                      background: color.muted,
                      textAlign: 'center',
                    }}
                  >
                    {invite.code}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: color.mutedForeground, textAlign: 'center' }}>
                    Expires {formatInviteExpiry(invite.expiresAt)}
                  </p>
                  <button onClick={handleCopyInviteCode} style={buttonStyle('secondary')}>
                    {copied ? 'Copied!' : 'Copy code'}
                  </button>
                </>
              ) : (
                <button onClick={handleGenerateInvite} disabled={generatingInvite} style={buttonStyle('primary')}>
                  {generatingInvite ? 'Generating…' : 'Generate code'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
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

      <ExpiryChart items={items} householdId={membership.householdId} />

      <LocationSummary items={items} />
    </div>
  );
}
