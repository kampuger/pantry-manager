import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet } from 'react-native';
import { getHouseholdNotificationPrefs, updateHouseholdNotificationPrefs } from '@pantry/supabase-client';
import { supabase } from '../../lib/supabaseClient';
import { AppButton } from '../AppButton';
import { color, cardStyle, inputStyle, font } from '../../lib/theme';

export function NotificationPrefsModal({
  householdId,
  visible,
  onClose,
}: {
  householdId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getHouseholdNotificationPrefs(supabase, householdId).then((prefs) => {
      setNotifyDaysProduce(String(prefs.notifyDaysProduce));
      setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
      setLoading(false);
    });
  }, [visible, householdId]);

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Notification preferences</Text>
          {loading ? (
            <Text style={styles.meta}>Loading…</Text>
          ) : (
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
              <Text style={styles.hint}>
                This sets your reminder timing. Push notifications are coming in a future update —
                for now this just saves your preference.
              </Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.buttonRow}>
                <AppButton title="Cancel" variant="secondary" onPress={onClose} />
                <AppButton title={saving ? 'Saving…' : 'Save'} onPress={handleSave} disabled={saving} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { ...cardStyle, backgroundColor: color.card, padding: 20, width: '100%', maxWidth: 360, gap: 10 },
  title: { fontSize: 16, fontFamily: font.bold, color: color.foreground },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  hint: { color: color.mutedForeground, fontSize: 12, fontFamily: font.regular },
  error: { color: color.destructive, fontSize: 13, fontFamily: font.regular },
  buttonRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
});
