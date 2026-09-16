import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView } from 'react-native';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate } from '@pantry/core';
import { formatExpiryDate } from '@pantry/ui';
import { ChipSelect } from '../ChipSelect';
import { AppButton } from '../AppButton';
import { color, radius, cardStyle, inputStyle, font } from '../../lib/theme';

export interface BulkItemInput {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  purchasePrice: number | null;
}

interface BulkRow {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string;
  purchasePrice: string;
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

function emptyRow(): BulkRow {
  return {
    key: nextRowKey(),
    name: '',
    quantity: '1',
    unit: UNIT_OPTIONS[0],
    storageLocation: STORAGE_LOCATION_OPTIONS[0],
    isProduce: true,
    expirationDate: '',
    purchasePrice: '',
  };
}

export function BulkAddModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (items: BulkItemInput[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<BulkRow[]>(() => [emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(key: string, changes: Partial<BulkRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.key !== key) : prev));
  }

  async function handleSubmit() {
    setError(null);

    // Blank rows (no name typed) are just unused scratch rows, not errors —
    // silently dropped rather than forcing the user to remove them by hand.
    const filled = rows.filter((row) => row.name.trim() !== '');
    if (filled.length === 0) {
      setError('Add at least one item (fill in a name for at least one row).');
      return;
    }

    const missingExpiry = filled.find((row) => !row.isProduce && !row.expirationDate);
    if (missingExpiry) {
      setError(`"${missingExpiry.name.trim()}" needs an expiration date (non-produce items can't auto-compute one).`);
      return;
    }

    const items: BulkItemInput[] = filled.map((row) => ({
      name: row.name.trim(),
      quantity: Number(row.quantity) || 0,
      unit: row.unit,
      storageLocation: row.storageLocation,
      isProduce: row.isProduce,
      expirationDate: row.isProduce ? computeExpiryDate({ isProduce: true }) : row.expirationDate,
      purchasePrice: row.purchasePrice ? Number(row.purchasePrice) : null,
    }));

    setSubmitting(true);
    try {
      await onSubmit(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.heading}>Add items</Text>
        <Text style={styles.subheading}>
          Fill in a row per item — add more rows as you need them, then save them all at once.
        </Text>
      </View>

      <ScrollView style={styles.rowsScroll} contentContainerStyle={styles.rowsScrollContent}>
        {rows.map((row, index) => (
          <View key={row.key} style={styles.rowCard}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>Item {index + 1}</Text>
              <Pressable onPress={() => removeRow(row.key)} disabled={rows.length === 1} hitSlop={8}>
                <Text style={[styles.removeText, rows.length === 1 && styles.removeTextDisabled]}>Remove</Text>
              </Pressable>
            </View>

            <TextInput
              placeholder="Name"
              value={row.name}
              onChangeText={(v) => updateRow(row.key, { name: v })}
              style={inputStyle}
            />

            <View style={styles.inlineRow}>
              <TextInput
                placeholder="Qty"
                keyboardType="numeric"
                value={row.quantity}
                onChangeText={(v) => updateRow(row.key, { quantity: v })}
                style={[inputStyle, styles.qtyInput]}
              />
              <View style={styles.unitChips}>
                <ChipSelect options={UNIT_OPTIONS} value={row.unit} onChange={(v) => updateRow(row.key, { unit: v })} />
              </View>
            </View>

            <TextInput
              placeholder="Price (₱, optional)"
              keyboardType="decimal-pad"
              value={row.purchasePrice}
              onChangeText={(v) => updateRow(row.key, { purchasePrice: v })}
              style={inputStyle}
            />

            <Text style={styles.fieldLabel}>Storage</Text>
            <ChipSelect
              options={STORAGE_LOCATION_OPTIONS}
              value={row.storageLocation}
              onChange={(v) => updateRow(row.key, { storageLocation: v })}
            />

            <View style={styles.produceRow}>
              <Text style={styles.produceLabel}>Produce (perishable)</Text>
              <Switch
                value={row.isProduce}
                onValueChange={(v) => updateRow(row.key, { isProduce: v, expirationDate: v ? '' : row.expirationDate })}
              />
            </View>

            {row.isProduce ? (
              <Text style={styles.autoExpiry}>
                Expires: {formatExpiryDate(computeExpiryDate({ isProduce: true }))} (auto)
              </Text>
            ) : (
              <View>
                <Text style={styles.fieldLabel}>Expires (YYYY-MM-DD)</Text>
                <TextInput
                  placeholder="2026-12-31"
                  value={row.expirationDate}
                  onChangeText={(v) => updateRow(row.key, { expirationDate: v })}
                  style={inputStyle}
                />
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <AppButton title="+ Add row" variant="secondary" onPress={addRow} />

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <AppButton title="Cancel" variant="secondary" onPress={onCancel} />
        <AppButton title={submitting ? 'Saving…' : 'Save all'} onPress={handleSubmit} disabled={submitting} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...cardStyle, width: '100%', maxHeight: '90%', padding: 20, gap: 14 },
  heading: { fontSize: 18, fontFamily: font.bold, color: color.foreground },
  subheading: { fontSize: 13, color: color.mutedForeground, fontFamily: font.regular, marginTop: 2 },
  rowsScroll: { flex: 1 },
  rowsScrollContent: { gap: 14, paddingBottom: 4 },
  rowCard: {
    backgroundColor: color.muted,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: 14,
    gap: 10,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { fontSize: 13, fontFamily: font.semibold, color: color.mutedForeground },
  removeText: { fontSize: 13, fontFamily: font.semibold, color: color.destructive },
  removeTextDisabled: { color: color.border },
  inlineRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  qtyInput: { width: 70 },
  unitChips: { flex: 1 },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  produceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  produceLabel: { fontSize: 14, fontFamily: font.semibold, color: color.foreground },
  autoExpiry: { fontSize: 13, color: color.mutedForeground, fontFamily: font.regular },
  errorBanner: {
    backgroundColor: color.destructiveBg,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  errorText: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: 14,
  },
});
