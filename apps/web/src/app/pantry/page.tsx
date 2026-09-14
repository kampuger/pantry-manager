'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFreshnessFlag } from '@pantry/core';
import { groupItemsByLocation } from '@pantry/ui';
import {
  addPantryItem,
  updatePantryItem,
  archivePantryItem,
  STORAGE_LOCATION_OPTIONS,
  type Database,
} from '@pantry/supabase-client';
import { pantrySeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { ItemForm, type ItemFormValues } from '@/components/pantry/ItemForm';
import { PantryLocationGroup } from '@/components/pantry/PantryLocationGroup';
import { color, cardStyle, buttonStyle, badgeStyle } from '@/lib/theme';

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

function ItemCard({ children }: { children: React.ReactNode }) {
  return <div style={{ ...cardStyle, padding: 16, display: 'grid', gap: 6 }}>{children}</div>;
}

function DemoPantryList() {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
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
  const { session, loading: authLoading } = useAuth();
  const { membership, create } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [editingItem, setEditingItem] = useState<PantryItemRow | null>(null);

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

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1>Pantry Inventory</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8 }}>
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
    <div>
      <h1>Pantry Inventory</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <div style={{ marginTop: 20 }}>
            <ItemForm submitLabel="Add item" onSubmit={handleAdd} />
          </div>
          {items.length === 0 && <p style={{ marginTop: 20, color: color.mutedForeground }}>No pantry items yet.</p>}
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
          {editingItem && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                zIndex: 50,
              }}
            >
              <div style={{ maxWidth: 640, width: '100%' }}>
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
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
