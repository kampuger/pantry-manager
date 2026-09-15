import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Switch, StyleSheet } from 'react-native';
import {
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
  triggerRemindersNow,
} from '@pantry/supabase-client';
import { useAuth } from '../../lib/AuthProvider';
import { supabase } from '../../lib/supabaseClient';
import { AppButton } from '../AppButton';
import { color, cardStyle, inputStyle, font } from '../../lib/theme';

export function NotificationPrefsModal({
  householdId,
  isAdmin,
  visible,
  onClose,
}: {
  householdId: string;
  isAdmin: boolean;
  visible: boolean;
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
    if (!visible || !session) return;
    setLoading(true);
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
  }, [visible, householdId, session]);

  async function handleToggleNotifications(next: boolean) {
    if (!session) return;
    setNotificationsEnabled(next);
    try {
      await setMemberNotificationsEnabled(supabase, householdId, session.user.id, next);
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Notification preferences</Text>
          {loading ? <Text style={styles.meta}>Loading…</Text> : null}
          {!loading && loadError ? (
            <Text style={styles.error}>Could not load your preferences: {loadError}</Text>
          ) : null}
          {!loading && !loadError ? (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.fieldLabel}>Notify me about expiring items</Text>
                <Switch value={notificationsEnabled} onValueChange={handleToggleNotifications} />
              </View>

              {isAdmin && (
                <>
                  <Text style={styles.fieldLabel}>Remind me before expiry — Produce items (days)</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={notifyDaysProduce}
                    onChangeText={setNotifyDaysProduce}
                    style={inputStyle}
                  />
                  <Text style={styles.fieldLabel}>Remind me before expiry — Non-produce items (days)</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={notifyDaysNonproduce}
                    onChangeText={setNotifyDaysNonproduce}
                    style={inputStyle}
                  />
                  <Text style={styles.fieldLabel}>Daily email send time (HH:MM)</Text>
                  <TextInput value={emailSendTime} onChangeText={setEmailSendTime} style={inputStyle} placeholder="08:00" />
                  <Text style={styles.fieldLabel}>Custom intro line (optional)</Text>
                  <TextInput
                    value={emailIntro}
                    onChangeText={setEmailIntro}
                    style={inputStyle}
                    placeholder="Hey team, don't forget:"
                  />
                  <AppButton
                    title={sendingNow ? 'Sending…' : 'Send reminders now'}
                    variant="secondary"
                    onPress={handleSendNow}
                    disabled={sendingNow}
                  />
                  {sendNowStatus && <Text style={styles.meta}>{sendNowStatus}</Text>}
                </>
              )}
              {error && <Text style={styles.error}>{error}</Text>}
            </>
          ) : null}
          <View style={styles.buttonRow}>
            <AppButton title="Cancel" variant="secondary" onPress={onClose} />
            {!loading && !loadError && isAdmin ? (
              <AppButton title={saving ? 'Saving…' : 'Save'} onPress={handleSave} disabled={saving} />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { ...cardStyle, backgroundColor: color.card, padding: 20, width: '100%', maxWidth: 360, gap: 10 },
  title: { fontSize: 16, fontFamily: font.bold, color: color.foreground },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  error: { color: color.destructive, fontSize: 13, fontFamily: font.regular },
  buttonRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
});
