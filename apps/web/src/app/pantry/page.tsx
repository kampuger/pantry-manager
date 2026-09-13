'use client';

import { useEffect, useState } from 'react';
import { getFreshnessFlag } from '@pantry/core';
import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import { getMyHousehold, createHousehold, type HouseholdMembership } from '@pantry/supabase-client';
import type { Database } from '@pantry/supabase-client';
import { pantrySeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const BADGE_STYLES: Record<ExpiryBadgeStatus, { background: string; color: string }> = {
  critical: { background: '#fee2e2', color: '#b91c1c' },
  warning: { background: '#fef3c7', color: '#92400e' },
  ok: { background: '#dcfce7', color: '#166534' },
  unknown: { background: '#e2e8f0', color: '#475569' },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function DemoPantryList() {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {pantrySeed.map((item) => {
        const freshnessFlag = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);

        return (
          <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{item.name}</strong>
              <span
                style={{
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: freshnessFlag ? '#fee2e2' : item.status === 'low' ? '#fef3c7' : '#dcfce7',
                  color: freshnessFlag ? '#b91c1c' : item.status === 'low' ? '#92400e' : '#166534',
                  fontSize: 12,
                  textTransform: 'capitalize',
                }}
              >
                {freshnessFlag ? 'flagged' : item.status}
              </span>
            </div>
            <div>
              {item.quantity} {item.unit}
            </div>
            <div>
              {item.location} • {item.category}
            </div>
            <div>Last restock: {new Date(item.lastRestock).toLocaleDateString()}</div>
            <div>Expires: {item.expiry}</div>
          </div>
        );
      })}
    </div>
  );
}

function CreateHouseholdForm({ userId, onCreated }: { userId: string; onCreated: (m: HouseholdMembership) => void }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const membership = await createHousehold(supabase, userId, name.trim() || 'My Household');
      onCreated(membership);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 20, maxWidth: 360 }}>
      <p>You&apos;re signed in, but not part of a household yet.</p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <input
          placeholder="Household name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: 8, cursor: 'pointer' }}>
          {submitting ? 'Creating…' : 'Create household'}
        </button>
      </form>
    </div>
  );
}

function RealPantryList({ items }: { items: PantryItemRow[] }) {
  if (items.length === 0) {
    return <p style={{ marginTop: 20, color: '#64748b' }}>No pantry items yet.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {items.map((item) => {
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
        const badge = BADGE_STYLES[status];

        return (
          <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{item.name}</strong>
              <span
                style={{
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: badge.background,
                  color: badge.color,
                  fontSize: 12,
                  textTransform: 'capitalize',
                }}
              >
                {status}
              </span>
            </div>
            <div>
              {item.quantity} {item.unit}
            </div>
            <div>{item.storage_location}</div>
            {item.expiration_date && <div>Expires: {item.expiration_date}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function PantryPage() {
  const { session, loading: authLoading } = useAuth();
  const [membership, setMembership] = useState<HouseholdMembership | null | 'loading'>('loading');
  const [items, setItems] = useState<PantryItemRow[]>([]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    setMembership('loading');

    getMyHousehold(supabase, session.user.id).then((result) => {
      if (!cancelled) setMembership(result);
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!membership || membership === 'loading') return;

    supabase
      .from('pantry_items')
      .select('*')
      .eq('household_id', membership.householdId)
      .eq('is_archived', false)
      .then(({ data }) => setItems(data ?? []));
  }, [membership]);

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1>Pantry Inventory</h1>
        <p style={{ color: '#64748b', marginTop: 8 }}>
          Viewing demo data — <a href="/login">sign in</a> to see your household&apos;s real pantry.
        </p>
        <DemoPantryList />
      </div>
    );
  }

  return (
    <div>
      <h1>Pantry Inventory</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: '#64748b' }}>Loading…</p>}
      {membership === null && (
        <CreateHouseholdForm userId={session.user.id} onCreated={setMembership} />
      )}
      {membership && membership !== 'loading' && <RealPantryList items={items} />}
    </div>
  );
}
