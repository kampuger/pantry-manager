import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from 'react-native';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate } from '@pantry/core';
import { ChipSelect } from '../ChipSelect';
import { AppButton } from '../AppButton';
import { color, cardStyle, inputStyle, font } from '../../lib/theme';

export interface ItemFormValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
}

export interface ItemFormInitialValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
  purchaseDate: string | null;
}

const EMPTY_VALUES: ItemFormInitialValues = {
  name: '',
  quantity: 1,
  unit: UNIT_OPTIONS[0],
  storageLocation: STORAGE_LOCATION_OPTIONS[0],
  isProduce: true,
  expirationDate: null,
  notifyDaysOverride: null,
  purchaseDate: null,
};

export function ItemForm({
  initialValues = EMPTY_VALUES,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialValues?: ItemFormInitialValues;
  submitLabel: string;
  onSubmit: (values: ItemFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(String(initialValues.quantity));
  const [unit, setUnit] = useState(initialValues.unit);
  const [storageLocation, setStorageLocation] = useState(initialValues.storageLocation);
  const [isProduce, setIsProduce] = useState(initialValues.isProduce);
  const [manualExpirationDate, setManualExpirationDate] = useState(initialValues.expirationDate ?? '');
  const [showAdvanced, setShowAdvanced] = useState(initialValues.notifyDaysOverride != null);
  const [notifyDaysOverride, setNotifyDaysOverride] = useState(
    initialValues.notifyDaysOverride != null ? String(initialValues.notifyDaysOverride) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedProduceExpiry = isProduce
    ? computeExpiryDate({ isProduce: true, purchaseDate: initialValues.purchaseDate ?? undefined })
    : null;

  function handleProduceToggle(next: boolean) {
    setIsProduce(next);
    if (!next) setManualExpirationDate('');
  }

  async function handleSubmit() {
    setError(null);
    if (!isProduce && !manualExpirationDate) {
      setError('Enter an expiration date for non-produce items.');
      return;
    }

    const expirationDate = isProduce
      ? computeExpiryDate({ isProduce: true, purchaseDate: initialValues.purchaseDate ?? undefined })
      : manualExpirationDate;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        quantity: Number(quantity) || 0,
        unit,
        storageLocation,
        isProduce,
        expirationDate,
        notifyDaysOverride: notifyDaysOverride ? Number(notifyDaysOverride) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextInput placeholder="Name" value={name} onChangeText={setName} style={inputStyle} />
      <TextInput
        placeholder="Quantity"
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        style={inputStyle}
      />
      <Text style={styles.fieldLabel}>Unit</Text>
      <ChipSelect options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
      <Text style={styles.fieldLabel}>Storage</Text>
      <ChipSelect options={STORAGE_LOCATION_OPTIONS} value={storageLocation} onChange={setStorageLocation} />
      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Produce (perishable)</Text>
        <Switch value={isProduce} onValueChange={handleProduceToggle} />
      </View>
      {isProduce ? (
        <View>
          <Text style={styles.fieldLabel}>Expires (auto)</Text>
          <Text style={[inputStyle, styles.readonlyValue]}>{computedProduceExpiry}</Text>
        </View>
      ) : (
        <View>
          <Text style={styles.fieldLabel}>Expires (YYYY-MM-DD)</Text>
          <TextInput
            placeholder="2026-12-31"
            value={manualExpirationDate}
            onChangeText={setManualExpirationDate}
            style={inputStyle}
          />
        </View>
      )}
      <Pressable onPress={() => setShowAdvanced((v) => !v)}>
        <Text style={styles.advancedToggle}>{showAdvanced ? 'Hide advanced' : 'Advanced'}</Text>
      </Pressable>
      {showAdvanced && (
        <View>
          <Text style={styles.fieldLabel}>Custom reminder (days before expiry)</Text>
          <TextInput
            placeholder="Use household default"
            keyboardType="numeric"
            value={notifyDaysOverride}
            onChangeText={setNotifyDaysOverride}
            style={inputStyle}
          />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.buttonRow}>
        <AppButton title={submitting ? 'Saving…' : submitLabel} onPress={handleSubmit} disabled={submitting} />
        {onCancel && <AppButton title="Cancel" variant="secondary" onPress={onCancel} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { ...cardStyle, padding: 16, gap: 10 },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  readonlyValue: { color: color.mutedForeground, backgroundColor: color.muted },
  advancedToggle: { color: color.primary, fontFamily: font.semibold, fontSize: 13 },
  error: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 8 },
});
