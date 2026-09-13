'use client';

import { useCallback, useEffect, useState } from 'react';
import { addGroceryListEntry, setGroceryListEntryChecked, deleteGroceryListEntry, UNIT_OPTIONS } from '@pantry/supabase-client';
import type { Database } from '@pantry/supabase-client';
import { shoppingSeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';

type GroceryListEntryRow = Database['public']['Tables']['grocery_list_entries']['Row'];

function DemoShoppingList() {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {shoppingSeed.map((item) => (
        <div
          key={item.id}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ textDecoration: item.checked ? 'line-through' : 'none', fontWeight: 600 }}>{item.name}</div>
            <div style={{ color: '#64748b' }}>
              {item.quantity} • {item.category}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600 }}>₱{item.estimatedCost}</div>
            <div style={{ color: item.priority === 'High' ? '#dc2626' : item.priority === 'Medium' ? '#d97706' : '#15803d' }}>
              {item.priority}
            </div>
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
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'end',
        marginTop: 20,
        padding: 16,
        border: '1px solid #e2e8f0',
        borderRadius: 12,
      }}
    >
      <label style={{ display: 'grid', gap: 4 }}>
        Item
        <input required value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 8 }} />
      </label>
      <label style={{ display: 'grid', gap: 4, width: 90 }}>
        Qty (optional)
        <input
          type="number"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={{ padding: 8 }}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        Unit (optional)
        <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ padding: 8 }}>
          <option value="">—</option>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={submitting} style={{ padding: 8, cursor: 'pointer' }}>
        {submitting ? 'Adding…' : 'Add to list'}
      </button>
      {error && <p style={{ color: '#b91c1c', width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function RealShoppingList({ entries, onChanged }: { entries: GroceryListEntryRow[]; onChanged: () => void }) {
  if (entries.length === 0) {
    return <p style={{ marginTop: 20, color: '#64748b' }}>Your shopping list is empty.</p>;
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
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={entry.is_checked} onChange={() => toggle(entry)} />
            <span style={{ textDecoration: entry.is_checked ? 'line-through' : 'none', color: entry.is_checked ? '#94a3b8' : undefined }}>
              {entry.name}
              {entry.quantity != null && ` — ${entry.quantity}${entry.unit ? ` ${entry.unit}` : ''}`}
            </span>
          </label>
          <button onClick={() => remove(entry)} style={{ cursor: 'pointer', color: '#b91c1c', background: 'none', border: 'none' }}>
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
        <p style={{ color: '#64748b', marginTop: 8 }}>
          Viewing demo data — <a href="/login">sign in</a> to see your household&apos;s real shopping list.
        </p>
        <DemoShoppingList />
      </div>
    );
  }

  return (
    <div>
      <h1>Shopping List</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: '#64748b' }}>Loading…</p>}
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
