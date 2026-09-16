'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMemberNotificationsEnabled, getHouseholdNotificationPrefs } from '@pantry/supabase-client';
import { daysUntil, getExpiryBadgeStatus, formatExpiryDate } from '@pantry/ui';
import { resolveNotifyThreshold } from '@pantry/core';
import { supabase } from '@/lib/supabaseClient';
import { useIsMobile } from '@/lib/useIsMobile';
import { color, cardStyle, radius } from '@/lib/theme';
import { onNotificationsChanged } from '@/lib/notificationEvents';

interface ReminderRow {
  pantryItemId: string;
  name: string;
  expirationDate: string;
}

export function NotificationBell({ householdId, userId }: { householdId: string; userId: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);

  // Close on any click outside the bell/dropdown — without this, the only
  // way to dismiss it was clicking the bell a second time, since clicking
  // elsewhere on the page (the natural first instinct) did nothing.
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function viewAllExpiring() {
    setOpen(false);
    router.push('/pantry?filter=expiring');
  }

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const value = await getMemberNotificationsEnabled(supabase, householdId, userId);
      if (cancelled) return;
      setEnabled(value);
      if (!value) {
        setReminders([]);
        return;
      }

      // Computed live from pantry_items + the household's own thresholds —
      // the SAME status logic the Pantry page's badges use — rather than
      // read from pantry_item_reminders, which is only refreshed once a day
      // by the cron job (or on "Send reminders now"). Reading that table
      // here would make the bell up to a day stale relative to what the
      // Pantry page already shows as Warning/Expired.
      const [prefs, itemsResult] = await Promise.all([
        getHouseholdNotificationPrefs(supabase, householdId),
        supabase
          .from('pantry_items')
          .select('id, name, expiration_date, is_produce, notify_days_before_expiry')
          .eq('household_id', householdId)
          .eq('is_archived', false)
          .not('expiration_date', 'is', null),
      ]);
      if (cancelled) return;

      const list = (itemsResult.data ?? [])
        .map((item) => {
          const threshold = resolveNotifyThreshold(
            { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
            prefs
          );
          const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
          return { pantryItemId: item.id, name: item.name, expirationDate: item.expiration_date!, status };
        })
        .filter((item) => item.status === 'warning' || item.status === 'expired')
        .sort((a, b) => (daysUntil(a.expirationDate) ?? 0) - (daysUntil(b.expirationDate) ?? 0));

      setReminders(list);
    }

    refresh();
    const unsubscribe = onNotificationsChanged(refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [householdId, userId]);

  if (!enabled) return null;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Expiring item reminders"
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          borderRadius: radius.sm,
          color: color.mutedForeground,
        }}
      >
        🔔
        {reminders.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: color.destructive,
              color: '#fff',
              borderRadius: 999,
              fontSize: 10,
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {reminders.length}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            ...cardStyle,
            position: 'absolute',
            top: '110%',
            // On mobile the bell sits near the right edge of the top bar, so
            // a left-anchored dropdown runs off-screen — anchor from the
            // right there instead. Desktop keeps the original left anchor
            // (the bell sits inside the left-side Sidebar).
            ...(isMobile ? { right: 0 } : { left: 0 }),
            width: 260,
            maxWidth: 'calc(100vw - 24px)',
            boxSizing: 'border-box',
            maxHeight: 320,
            overflowY: 'auto',
            padding: 12,
            zIndex: 60,
          }}
        >
          {reminders.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: color.mutedForeground }}>No expiring items right now.</p>
          ) : (
            <>
              {reminders.map((r) => {
                const days = daysUntil(r.expirationDate);
                return (
                  <button
                    key={r.pantryItemId}
                    onClick={viewAllExpiring}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '6px 0',
                      borderBottom: `1px solid ${color.border}`,
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: color.foreground }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: color.mutedForeground }}>
                      {days === null
                        ? 'Unknown expiry'
                        : days < 0
                          ? `Expired ${formatExpiryDate(r.expirationDate)}`
                          : days === 0
                            ? 'Expires today'
                            : `Expires in ${days}d`}
                    </div>
                  </button>
                );
              })}
              <button
                onClick={viewAllExpiring}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '10px 0 2px',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 600,
                  color: color.primary,
                }}
              >
                View all expiring or expired items →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
