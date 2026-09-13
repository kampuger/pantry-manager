'use client';

import { useCallback, useEffect, useState } from 'react';
import { addGroceryListEntry, setGroceryListEntryChecked, deleteGroceryListEntry, UNIT_OPTIONS } from '@pantry/supabase-client';
import type { Database } from '@pantry/supabase-client';
import { shoppingSeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

type GroceryListEntryRow = Database['public']['Tables']['grocery_list_entries']['Row'];

const PRIORITY_COLOR: Record<string, string> = {
  High: color.destructive,
  Medium: color.warning,
  Low: color.success,
};

function DemoShoppingList() {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {shoppingSeed.map((item) => (
        <div
          key={item.id}
          style={{ ...cardStyle, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div style={{ textDecoration: item.checked ? 'line-through' : 'none', fontWeight: 600 }}>{item.name}</div>
            <div style={{ color: color.mutedForeground, fontSize: 14 }}>
              {item.quantity} · {item.category}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700 }}>₱{item.estimatedCost}</div>
            <div style={{ color: PRIORITY_COLOR[item.priority], fontSize: 13, fontWeight: 600 }}>{item.priority}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AddEntryForm({
  householdId,
  userId,
  onAdded,
}: {
  householdId: string;
  userId: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addGroceryListEntry(supabase, householdId, userId, {
        name: name.trim(),
        quantity: quantity ? Number(quantity) : null,
        unit: unit || null,
      });
      setName('');
      setQuantity('');
      setUnit('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add entry');
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
        Item
        <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ ...labelStyle, width: 110 }}>
        Qty (optional)
        <input
          type="number"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Unit (optional)
        <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
          <option value="">—</option>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
        {submitting ? 'Adding…' : 'Add to list'}
      </button>
      {error && <p style={{ color: color.destructive, width: '100%', margin: 0, fontSize: 13 }}>{error}</p>}
    </form>
  );
}

function RealShoppingList({ entries, onChanged }: { entries: GroceryListEntryRow[]; onChanged: () => void }) {
  if (entries.length === 0) {
    return <p style={{ marginTop: 20, color: color.mutedForeground }}>Your shopping list is empty.</p>;
  }

  async function toggle(entry: GroceryListEntryRow) {
    await setGroceryListEntryChecked(supabase, entry.id, !entry.is_checked);
    onChanged();
  }

  async function remove(entry: GroceryListEntryRow) {
    await deleteGroceryListEntry(supabase, entry.id);
    onChanged();
  }

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{ ...cardStyle, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={entry.is_checked}
              onChange={() => toggle(entry)}
              style={{ width: 18, height: 18, accentColor: color.primary, cursor: 'pointer' }}
            />
            <span
              style={{
                textDecoration: entry.is_checked ? 'line-through' : 'none',
                color: entry.is_checked ? color.mutedForeground : color.foreground,
              }}
            >
              {entry.name}
              {entry.quantity != null && ` — ${entry.quantity}${entry.unit ? ` ${entry.unit}` : ''}`}
            </span>
          </label>
          <button onClick={() => remove(entry)} style={buttonStyle('danger')}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export default function ShoppingListPage() {
  const { session, loading: authLoading } = useAuth();
  const { membership, create } = useHousehold();
  const [entries, setEntries] = useState<GroceryListEntryRow[]>([]);

  const refreshEntries = useCallback((householdId: string) => {
    supabase
      .from('grocery_list_entries')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setEntries(data ?? []));
  }, []);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    refreshEntries(membership.householdId);
  }, [membership, refreshEntries]);

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1>Shopping List</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8 }}>
          Viewing demo data —{' '}
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            sign in
          </a>{' '}
          to see your household&apos;s real shopping list.
        </p>
        <DemoShoppingList />
      </div>
    );
  }

  return (
    <div>
      <h1>Shopping List</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <AddEntryForm
            householdId={membership.householdId}
            userId={session.user.id}
            onAdded={() => refreshEntries(membership.householdId)}
          />
          <RealShoppingList entries={entries} onChanged={() => refreshEntries(membership.householdId)} />
        </>
      )}
    </div>
  );
}
