'use client';

import { useEffect, useState } from 'react';
import {
  getPantryItemReminders,
  getMemberNotificationsEnabled,
  type PantryItemReminder,
} from '@pantry/supabase-client';
import { daysUntil } from '@pantry/ui';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, radius } from '@/lib/theme';

export function NotificationBell({ householdId, userId }: { householdId: string; userId: string }) {
  const [reminders, setReminders] = useState<PantryItemReminder[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getMemberNotificationsEnabled(supabase, householdId, userId).then((value) => {
      if (!cancelled) setEnabled(value);
    });

    if (enabled) {
      getPantryItemReminders(supabase, householdId).then((list) => {
        if (!cancelled) setReminders(list);
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userId]);

  if (!enabled) return null;

  return (
    <div style={{ position: 'relative' }}>
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
            left: 0,
            width: 260,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 12,
            zIndex: 60,
          }}
        >
          {reminders.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: color.mutedForeground }}>No expiring items right now.</p>
          ) : (
            reminders.map((r) => {
              const days = daysUntil(r.expirationDate);
              return (
                <div key={r.pantryItemId} style={{ padding: '6px 0', borderBottom: `1px solid ${color.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: color.mutedForeground }}>
                    {days === null ? 'Unknown expiry' : days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `Expires in ${days}d`}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
