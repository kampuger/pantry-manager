'use client';

import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import type { Database } from '@pantry/supabase-client';
import { color, cardStyle, badgeStyle, buttonStyle } from '@/lib/theme';

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

export function PantryLocationGroup({
  icon,
  label,
  expiringSoonCount,
  items,
  onEdit,
  onConsumed,
  onExpired,
}: {
  icon: string;
  label: string;
  expiringSoonCount: number;
  items: PantryItemRow[];
  onEdit: (item: PantryItemRow) => void;
  onConsumed: (item: PantryItemRow) => void;
  onExpired: (item: PantryItemRow) => void;
}) {
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <h2 style={{ fontSize: 16, margin: 0 }}>{label}</h2>
        <span style={{ color: color.mutedForeground, fontSize: 13 }}>
          {items.length} item{items.length === 1 ? '' : 's'}
          {expiringSoonCount > 0 && `, ${expiringSoonCount} expiring soon`}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((item) => {
          const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
          return (
            <div key={item.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>
                  {item.is_produce ? '🥬 ' : ''}
                  {item.name}
                </strong>
                <span style={badgeStyle(EXPIRY_TONE[status])}>{status}</span>
              </div>
              <div style={{ color: color.mutedForeground, fontSize: 14 }}>
                {item.quantity} {item.unit}
                {item.expiration_date && ` · Expires ${item.expiration_date}`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onEdit(item)} style={buttonStyle('secondary')}>Edit</button>
                <button onClick={() => onConsumed(item)} style={buttonStyle('secondary')}>Consumed</button>
                <button onClick={() => onExpired(item)} style={buttonStyle('danger')}>Expired/Discard</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
