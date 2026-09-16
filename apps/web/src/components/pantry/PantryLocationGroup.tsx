'use client';

import { useState } from 'react';
import { daysUntil, getExpiryBadgeStatus, formatExpiryDate, type ExpiryBadgeStatus } from '@pantry/ui';
import { resolveNotifyThreshold, formatPHP, type HouseholdNotifyDefaults } from '@pantry/core';
import type { Database } from '@pantry/supabase-client';
import { color, radius, cardStyle, badgeStyle, buttonStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  expired: 'destructive',
  warning: 'warning',
  good: 'success',
  unknown: 'muted',
};

// Left accent rail per card — instant scannability without adding colors;
// every value below is an existing token from lib/theme.
const EXPIRY_ACCENT: Record<ExpiryBadgeStatus, string> = {
  expired: color.destructive,
  warning: color.warning,
  good: color.success,
  unknown: color.border,
};

export function PantryLocationGroup({
  icon,
  label,
  expiringSoonCount,
  expiredCount,
  items,
  notifyPrefs,
  onEdit,
  onConsumed,
  onExpired,
}: {
  icon: string;
  label: string;
  expiringSoonCount: number;
  expiredCount: number;
  items: PantryItemRow[];
  notifyPrefs: HouseholdNotifyDefaults;
  onEdit: (item: PantryItemRow) => void;
  onConsumed: (item: PantryItemRow) => void;
  onExpired: (item: PantryItemRow) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section style={{ marginTop: 32 }}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          flexWrap: 'wrap',
          background: 'none',
          border: 'none',
          padding: 0,
          marginBottom: collapsed ? 0 : 14,
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 11,
            color: color.mutedForeground,
            transform: collapsed ? 'none' : 'rotate(90deg)',
            transition: 'transform 150ms ease',
            flexShrink: 0,
          }}
        >
          ▸
        </span>
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
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '-0.01em', color: color.foreground }}>
            {label}
          </h2>
          <span style={{ color: color.mutedForeground, fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {expiringSoonCount > 0 && (
            <span style={badgeStyle('warning')}>{expiringSoonCount} expiring soon</span>
          )}
          {expiredCount > 0 && <span style={badgeStyle('destructive')}>{expiredCount} expired</span>}
        </div>
      </button>
      {!collapsed && (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((item) => {
            const threshold = resolveNotifyThreshold(
              { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
              notifyPrefs
            );
            const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
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
                  {item.purchase_price != null && <span>{formatPHP(item.purchase_price)}</span>}
                  {item.expiration_date && <span>Expires: {formatExpiryDate(item.expiration_date)}</span>}
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
      )}
    </section>
  );
}
