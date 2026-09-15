'use client';

import { useEffect, useState } from 'react';
import {
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
  triggerRemindersNow,
} from '@pantry/supabase-client';
import { useAuth } from '@/lib/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';
import { emitNotificationsChanged } from '@/lib/notificationEvents';

export function NotificationPrefsModal({
  householdId,
  isAdmin,
  onClose,
}: {
  householdId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [emailSendTime, setEmailSendTime] = useState('08:00');
  const [emailIntro, setEmailIntro] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState(false);
  const [sendNowStatus, setSendNowStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      getHouseholdNotificationPrefs(supabase, householdId),
      getMemberNotificationsEnabled(supabase, householdId, session.user.id),
    ])
      .then(([prefs, memberEnabled]) => {
        setNotifyDaysProduce(String(prefs.notifyDaysProduce));
        setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
        setEmailSendTime(prefs.emailSendTime.slice(0, 5));
        setEmailIntro(prefs.emailIntro ?? '');
        setNotificationsEnabled(memberEnabled);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load preferences');
      })
      .finally(() => setLoading(false));
  }, [householdId, session]);

  async function handleToggleNotifications(next: boolean) {
    if (!session) return;
    setNotificationsEnabled(next);
    try {
      await setMemberNotificationsEnabled(supabase, householdId, session.user.id, next);
      emitNotificationsChanged();
    } catch (err) {
      setNotificationsEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to update your notification setting');
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateHouseholdNotificationPrefs(supabase, householdId, {
        notifyDaysProduce: Number(notifyDaysProduce) || 0,
        notifyDaysNonproduce: Number(notifyDaysNonproduce) || 0,
        emailSendTime,
        emailIntro: emailIntro.trim() || null,
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

  async function handleSendNow() {
    setSendingNow(true);
    setSendNowStatus(null);
    try {
      const result = await triggerRemindersNow(supabase, householdId);
      setSendNowStatus(result.status === 'sent' ? 'Reminders sent.' : `Nothing to send (${result.status}).`);
    } catch (err) {
      setSendNowStatus(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setSendingNow(false);
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
      <div style={{ ...cardStyle, padding: 24, width: 380, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Notification preferences</h2>
        {loading && <p style={{ color: color.mutedForeground, fontSize: 13, margin: 0 }}>Loading…</p>}
        {!loading && loadError && (
          <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>
            Couldn&apos;t load your preferences: {loadError}
          </p>
        )}
        {!loading && !loadError && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => handleToggleNotifications(e.target.checked)}
              />
              Notify me about expiring items (in-app and email)
            </label>

            {isAdmin && (
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
                <label style={labelStyle}>
                  Daily email send time
                  <input
                    type="time"
                    value={emailSendTime}
                    onChange={(e) => setEmailSendTime(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Custom intro line (optional)
                  <input
                    type="text"
                    value={emailIntro}
                    onChange={(e) => setEmailIntro(e.target.value)}
                    placeholder="Hey team, don't forget:"
                    style={inputStyle}
                  />
                </label>
                <div>
                  <button type="button" onClick={handleSendNow} disabled={sendingNow} style={buttonStyle('secondary')}>
                    {sendingNow ? 'Sending…' : 'Send reminders now'}
                  </button>
                  {sendNowStatus && (
                    <p style={{ fontSize: 12, color: color.mutedForeground, margin: '6px 0 0' }}>{sendNowStatus}</p>
                  )}
                </div>
              </>
            )}
            {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={buttonStyle('ghost')}>Cancel</button>
          {!loading && !loadError && isAdmin && (
            <button type="button" onClick={handleSave} disabled={saving} style={buttonStyle('primary')}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
