'use client';

import { useState } from 'react';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate } from '@pantry/core';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

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
  /** The item's existing purchase date; null on add (defaults to today). */
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    <form
      onSubmit={handleSubmit}
      style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', padding: 20 }}
    >
      <label style={{ ...labelStyle, flex: '1 1 160px' }}>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ ...labelStyle, width: 90 }}>
        Qty
        <input
          type="number"
          min="0"
          step="any"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Unit
        <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Storage
        <select value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} style={inputStyle}>
          {STORAGE_LOCATION_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isProduce} onChange={(e) => handleProduceToggle(e.target.checked)} />
        Produce (perishable)
      </label>
      {isProduce ? (
        <div style={{ ...labelStyle, minWidth: 160 }}>
          Expires
          <div style={{ ...inputStyle, background: color.muted, color: color.mutedForeground }}>
            {computedProduceExpiry} (auto)
          </div>
        </div>
      ) : (
        <label style={labelStyle}>
          Expires
          <input
            type="date"
            required
            value={manualExpirationDate}
            onChange={(e) => setManualExpirationDate(e.target.value)}
            style={inputStyle}
          />
        </label>
      )}
      <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={buttonStyle('ghost')}>
        {showAdvanced ? 'Hide advanced' : 'Advanced'}
      </button>
      {showAdvanced && (
        <label style={labelStyle}>
          Custom reminder (days before expiry)
          <input
            type="number"
            min="0"
            placeholder="Use household default"
            value={notifyDaysOverride}
            onChange={(e) => setNotifyDaysOverride(e.target.value)}
            style={inputStyle}
          />
        </label>
      )}
      <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} style={buttonStyle('ghost')}>
          Cancel
        </button>
      )}
      {error && <p style={{ color: color.destructive, width: '100%', margin: 0, fontSize: 13 }}>{error}</p>}
    </form>
  );
}
