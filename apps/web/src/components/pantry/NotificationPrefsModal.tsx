'use client';

import { useEffect, useState } from 'react';
import { getHouseholdNotificationPrefs, updateHouseholdNotificationPrefs } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export function NotificationPrefsModal({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHouseholdNotificationPrefs(supabase, householdId)
      .then((prefs) => {
        setNotifyDaysProduce(String(prefs.notifyDaysProduce));
        setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load preferences');
      })
      .finally(() => setLoading(false));
  }, [householdId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateHouseholdNotificationPrefs(supabase, householdId, {
        notifyDaysProduce: Number(notifyDaysProduce) || 0,
        notifyDaysNonproduce: Number(notifyDaysNonproduce) || 0,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (only household owners/admins can change these settings)`
          : 'Failed to save preferences'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
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
      <div style={{ ...cardStyle, padding: 24, width: 360, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Notification preferences</h2>
        {loading && <p style={{ color: color.mutedForeground, fontSize: 13, margin: 0 }}>Loading…</p>}
        {!loading && loadError && (
          <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>
            Couldn&apos;t load your preferences: {loadError}
          </p>
        )}
        {!loading && !loadError && (
          <>
            <label style={labelStyle}>
              Remind me before expiry — Produce items (days)
              <input
                type="number"
                min="0"
                value={notifyDaysProduce}
                onChange={(e) => setNotifyDaysProduce(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Remind me before expiry — Non-produce items (days)
              <input
                type="number"
                min="0"
                value={notifyDaysNonproduce}
                onChange={(e) => setNotifyDaysNonproduce(e.target.value)}
                style={inputStyle}
              />
            </label>
            <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>
              This sets your reminder timing. Push/browser notifications are coming in a future
              update — for now this just saves your preference.
            </p>
            {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
          </>
        )}
        {/* Always rendered, whatever the load state — otherwise a failed fetch
            leaves the user with no way out of the modal. */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={buttonStyle('ghost')}>Cancel</button>
          {!loading && !loadError && (
            <button type="button" onClick={handleSave} disabled={saving} style={buttonStyle('primary')}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
