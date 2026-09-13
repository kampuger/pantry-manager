'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFreshnessFlag } from '@pantry/core';
import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import { addPantryItem, UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import type { Database } from '@pantry/supabase-client';
import { pantrySeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { color, cardStyle, inputStyle, buttonStyle, badgeStyle, labelStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  critical: 'destructive',
  warning: 'warning',
  ok: 'success',
  unknown: 'muted',
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

function AddItemForm({
  householdId,
  userId,
  onAdded,
}: {
  householdId: string;
  userId: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<string>(UNIT_OPTIONS[0]);
  const [storageLocation, setStorageLocation] = useState<string>(STORAGE_LOCATION_OPTIONS[0]);
  const [expirationDate, setExpirationDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addPantryItem(supabase, householdId, userId, {
        name: name.trim(),
        quantity: Number(quantity) || 0,
        unit,
        storageLocation,
        expirationDate: expirationDate || null,
      });
      setName('');
      setQuantity('1');
      setExpirationDate('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', marginTop: 20, padding: 20 }}
    >
      <label style={{ ...labelStyle, flex: '1 1 160px' }}>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ ...labelStyle, width: 90 }}>
        Qty
        <input
          type="number"
          min="0"
          step="any"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Unit
        <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Storage
        <select value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} style={inputStyle}>
          {STORAGE_LOCATION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Expires (optional)
        <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} style={inputStyle} />
      </label>
      <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
        {submitting ? 'Adding…' : 'Add item'}
      </button>
      {error && <p style={{ color: color.destructive, width: '100%', margin: 0, fontSize: 13 }}>{error}</p>}
    </form>
  );
}

function RealPantryList({ items }: { items: PantryItemRow[] }) {
  if (items.length === 0) {
    return <p style={{ marginTop: 20, color: color.mutedForeground }}>No pantry items yet.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {items.map((item) => {
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));

        return (
          <ItemCard key={item.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{item.name}</strong>
              <span style={badgeStyle(EXPIRY_TONE[status])}>{status}</span>
            </div>
            <div style={{ color: color.mutedForeground, fontSize: 14 }}>
              {item.quantity} {item.unit} · {item.storage_location}
              {item.expiration_date && ` · Expires ${item.expiration_date}`}
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

  return (
    <div>
      <h1>Pantry Inventory</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <AddItemForm
            householdId={membership.householdId}
            userId={session.user.id}
            onAdded={() => refreshItems(membership.householdId)}
          />
          <RealPantryList items={items} />
        </>
      )}
    </div>
  );
}
