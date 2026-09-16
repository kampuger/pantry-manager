'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getFreshnessFlag, resolveNotifyThreshold, formatPHP, type HouseholdNotifyDefaults } from '@pantry/core';
import { daysUntil, getExpiryBadgeStatus, groupItemsByLocation } from '@pantry/ui';
import {
  addPantryItem,
  addPantryItems,
  updatePantryItem,
  archivePantryItem,
  getHouseholdNotificationPrefs,
  STORAGE_LOCATION_OPTIONS,
  type Database,
} from '@pantry/supabase-client';
import { pantrySeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { ItemForm, type ItemFormValues } from '@/components/pantry/ItemForm';
import { BulkAddModal, type BulkItemInput } from '@/components/pantry/BulkAddModal';
import { PantryLocationGroup } from '@/components/pantry/PantryLocationGroup';
import { NotificationPrefsModal } from '@/components/pantry/NotificationPrefsModal';
import { color, radius, cardStyle, inputStyle, buttonStyle, badgeStyle } from '@/lib/theme';
import { emitNotificationsChanged } from '@/lib/notificationEvents';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
};

const MODAL_OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.4)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '40px 16px',
  overflowY: 'auto',
  zIndex: 50,
};

function ItemCard({ children }: { children: React.ReactNode }) {
  return <div style={{ ...cardStyle, padding: '14px 16px', display: 'grid', gap: 8 }}>{children}</div>;
}

function DemoPantryList() {
  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 24 }}>
      {pantrySeed.map((item) => {
        const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);
        const tone = flagged ? 'destructive' : item.status === 'low' ? 'warning' : 'success';

        return (
          <ItemCard key={item.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{item.name}</strong>
              <span style={badgeStyle(tone)}>{flagged ? 'flagged' : item.status}</span>
            </div>
            <div style={{ color: color.mutedForeground, fontSize: 14 }}>
              {item.quantity} {item.unit} · {item.location} · {item.category}
            </div>
            <div style={{ color: color.mutedForeground, fontSize: 13 }}>
              Last restock: {new Date(item.lastRestock).toLocaleDateString()} · Expires: {item.expiry}
            </div>
          </ItemCard>
        );
      })}
    </div>
  );
}

export default function PantryPage() {
  return (
    <Suspense fallback={null}>
      <PantryPageContent />
    </Suspense>
  );
}

function PantryPageContent() {
  const { session, loading: authLoading } = useAuth();
  const { membership, create } = useHousehold();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [editingItem, setEditingItem] = useState<PantryItemRow | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showExpiringOnly, setShowExpiringOnly] = useState(searchParams.get('filter') === 'expiring');
  const [pageError, setPageError] = useState<string | null>(null);

  // Re-syncs from the URL whenever it changes — not just on mount. The
  // notification bell's "View all expiring items" link navigates to this
  // same route with a new query string, which Next.js does not remount for,
  // so a useState initializer alone would miss it.
  useEffect(() => {
    setShowExpiringOnly(searchParams.get('filter') === 'expiring');
  }, [searchParams]);
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
            setPageError(`Couldn't load your pantry: ${error.message}`);
            return;
          }
          setPageError(null);
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

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Pantry Inventory</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          Viewing demo data —{' '}
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            sign in
          </a>{' '}
          to see your household&apos;s real pantry.
        </p>
        <DemoPantryList />
      </div>
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
      purchasePrice: values.purchasePrice,
    });
    setShowAddForm(false);
    await refreshItems(membership.householdId);
  }

  async function handleBulkAdd(bulkItems: BulkItemInput[]) {
    if (!membership || membership === 'loading') return;
    await addPantryItems(supabase, membership.householdId, session!.user.id, bulkItems);
    setShowBulkAdd(false);
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
      purchasePrice: values.purchasePrice,
    });
    setEditingItem(null);
    await refreshItems(membership.householdId);
  }

  // Called as a floating promise from the card actions, so it swallows its own
  // errors into the page banner rather than rejecting into nothing.
  async function handleArchive(item: PantryItemRow, eventType: 'CONSUMED' | 'SPOILED_DISCARDED') {
    if (!membership || membership === 'loading') return;
    try {
      setPageError(null);
      await archivePantryItem(supabase, {
        itemId: item.id,
        householdId: membership.householdId,
        quantity: item.quantity,
        eventType,
        userId: session!.user.id,
      });
      // The item is now archived (is_archived = true), so it must drop out of
      // the bell/badge immediately rather than waiting for the next unrelated
      // notificationEvents emission (e.g. a prefs save) to trigger a refetch.
      emitNotificationsChanged();
      await refreshItems(membership.householdId);
    } catch (err) {
      setPageError(
        err instanceof Error ? `Couldn't update ${item.name}: ${err.message}` : `Couldn't update ${item.name}.`
      );
    }
  }

  // Reflects every active item regardless of the search/filter above — those
  // are view conveniences, not a redefinition of "what my pantry is worth."
  const totalValue = items.reduce((sum, item) => sum + (item.purchase_price ?? 0), 0);
  const hasAnyPriced = items.some((item) => item.purchase_price != null);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (trimmedQuery && !item.name.toLowerCase().includes(trimmedQuery)) return false;
    if (showExpiringOnly) {
      const threshold = resolveNotifyThreshold(
        { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
        notifyPrefs
      );
      const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
      if (status !== 'warning' && status !== 'expired') return false;
    }
    return true;
  });

  const groups = groupItemsByLocation(
    visibleItems.map((item) => ({
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
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Pantry Inventory</h1>
          {hasAnyPriced && (
            <p style={{ margin: '4px 0 0', fontSize: 14, color: color.mutedForeground }}>
              Total value: <strong style={{ color: color.foreground }}>{formatPHP(totalValue)}</strong>
            </p>
          )}
        </div>
        {membership && membership !== 'loading' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowPrefs(true)}
              style={{
                ...buttonStyle('secondary'),
                padding: '8px 14px',
                borderRadius: radius.pill,
                color: color.mutedForeground,
                whiteSpace: 'nowrap',
              }}
              aria-label="Notification preferences"
            >
              ⚙️ Notifications
            </button>
            <button
              onClick={() => setShowBulkAdd(true)}
              style={{ ...buttonStyle('secondary'), padding: '8px 16px', borderRadius: radius.pill, whiteSpace: 'nowrap' }}
            >
              + Add multiple
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              style={{ ...buttonStyle('primary'), padding: '8px 16px', borderRadius: radius.pill, whiteSpace: 'nowrap' }}
            >
              + Add item
            </button>
          </div>
        )}
      </div>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items…"
              aria-label="Search pantry items"
              style={{ ...inputStyle, flex: '1 1 220px' }}
            />
            <button
              onClick={() => setShowExpiringOnly((v) => !v)}
              aria-pressed={showExpiringOnly}
              style={{
                ...buttonStyle(showExpiringOnly ? 'primary' : 'secondary'),
                padding: '8px 16px',
                borderRadius: radius.pill,
                whiteSpace: 'nowrap',
              }}
            >
              ⚠️ Expiring or expired
            </button>
          </div>
          {pageError && (
            <p
              role="alert"
              style={{
                ...cardStyle,
                boxShadow: 'none',
                background: color.destructiveBg,
                borderColor: color.destructive,
                marginTop: 16,
                marginBottom: 0,
                padding: '12px 16px',
                color: color.destructive,
                fontSize: 13,
              }}
            >
              {pageError}
            </p>
          )}
          {!pageError && items.length === 0 && (
            <p
              style={{
                ...cardStyle,
                borderStyle: 'dashed',
                boxShadow: 'none',
                background: color.muted,
                marginTop: 24,
                marginBottom: 0,
                padding: '24px 16px',
                textAlign: 'center',
                color: color.mutedForeground,
                fontSize: 14,
              }}
            >
              No pantry items yet.
            </p>
          )}
          {!pageError && items.length > 0 && visibleItems.length === 0 && (
            <p
              style={{
                ...cardStyle,
                borderStyle: 'dashed',
                boxShadow: 'none',
                background: color.muted,
                marginTop: 24,
                marginBottom: 0,
                padding: '24px 16px',
                textAlign: 'center',
                color: color.mutedForeground,
                fontSize: 14,
              }}
            >
              No items match{trimmedQuery ? ` "${searchQuery.trim()}"` : ''}
              {showExpiringOnly ? ' and are expiring or expired' : ''}.
            </p>
          )}
          {groups.map((group) => (
            <PantryLocationGroup
              key={group.location}
              icon={LOCATION_META[group.location].icon}
              label={LOCATION_META[group.location].label}
              expiringSoonCount={group.expiringSoonCount}
              expiredCount={group.expiredCount}
              items={visibleItems.filter((item) => group.itemIds.includes(item.id))}
              notifyPrefs={notifyPrefs}
              onEdit={setEditingItem}
              onConsumed={(item) => handleArchive(item, 'CONSUMED')}
              onExpired={(item) => handleArchive(item, 'SPOILED_DISCARDED')}
            />
          ))}
          {showAddForm && (
            <div style={MODAL_OVERLAY_STYLE}>
              <div style={{ maxWidth: 640, width: '100%' }}>
                <ItemForm
                  mode="add"
                  submitLabel="Add item"
                  onCancel={() => setShowAddForm(false)}
                  onSubmit={handleAdd}
                />
              </div>
            </div>
          )}
          {showBulkAdd && (
            <div style={MODAL_OVERLAY_STYLE}>
              <BulkAddModal onCancel={() => setShowBulkAdd(false)} onSubmit={handleBulkAdd} />
            </div>
          )}
          {editingItem && (
            <div style={MODAL_OVERLAY_STYLE}>
              <div style={{ maxWidth: 640, width: '100%' }}>
                <ItemForm
                  mode="edit"
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
                    purchasePrice: editingItem.purchase_price,
                    purchaseDate: editingItem.purchase_date,
                  }}
                  onSubmit={handleEditSave}
                />
              </div>
            </div>
          )}
          {showPrefs && membership && (
            <NotificationPrefsModal
              householdId={membership.householdId}
              isAdmin={membership.role !== 'MEMBER'}
              onClose={() => setShowPrefs(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
