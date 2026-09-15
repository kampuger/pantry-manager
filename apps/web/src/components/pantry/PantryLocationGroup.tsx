'use client';

import { daysUntil, getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import type { Database } from '@pantry/supabase-client';
import { color, radius, cardStyle, badgeStyle, buttonStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  expired: 'destructive',
  critical: 'destructive',
  warning: 'warning',
  ok: 'success',
  unknown: 'muted',
};

// Left accent rail per card — instant scannability without adding colors:
// every value below is an existing token from lib/theme. 'expired' shares the
// destructive badge with 'critical' but gets the dark foreground rail, so the
// two read as different states at a glance.
const EXPIRY_ACCENT: Record<ExpiryBadgeStatus, string> = {
  expired: color.foreground,
  critical: color.destructive,
  warning: color.warning,
  ok: color.secondary,
  unknown: color.border,
};

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
    <section style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: radius.md,
            background: color.muted,
            border: `1px solid ${color.border}`,
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{label}</h2>
          <span style={{ color: color.mutedForeground, fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </div>
        {expiringSoonCount > 0 && (
          <span style={{ ...badgeStyle('warning'), marginLeft: 'auto' }}>{expiringSoonCount} expiring soon</span>
        )}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {items.map((item) => {
          const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
          return (
            <div
              key={item.id}
              style={{
                ...cardStyle,
                borderLeft: `3px solid ${EXPIRY_ACCENT[status]}`,
                padding: '14px 16px',
                display: 'grid',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <strong style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                  {item.is_produce ? '🥬 ' : ''}
                  {item.name}
                </strong>
                <span style={{ ...badgeStyle(EXPIRY_TONE[status]), flexShrink: 0, textTransform: 'capitalize' }}>
                  {status}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  color: color.mutedForeground,
                  fontSize: 13,
                }}
              >
                <span style={badgeStyle('muted')}>
                  {item.quantity} {item.unit}
                </span>
                {item.expiration_date && <span>Expires {item.expiration_date}</span>}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  borderTop: `1px solid ${color.border}`,
                  paddingTop: 10,
                }}
              >
                <button onClick={() => onEdit(item)} style={{ ...buttonStyle('secondary'), padding: '8px 14px' }}>
                  Edit
                </button>
                <button
                  onClick={() => onConsumed(item)}
                  style={{
                    ...buttonStyle('secondary'),
                    padding: '8px 14px',
                    background: color.successBg,
                    borderColor: color.border,
                    // primaryDark (not primary) keeps AA contrast on successBg.
                    color: color.primaryDark,
                  }}
                >
                  Consumed
                </button>
                <button
                  onClick={() => onExpired(item)}
                  style={{ ...buttonStyle('danger'), padding: '8px 10px', marginLeft: 'auto' }}
                >
                  Expired/Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
