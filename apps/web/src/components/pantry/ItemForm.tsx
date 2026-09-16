'use client';

import { useState } from 'react';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate } from '@pantry/core';
import { color, radius, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export interface ItemFormValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
  purchasePrice: number | null;
}

export interface ItemFormInitialValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
  purchasePrice: number | null;
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
  purchasePrice: null,
  purchaseDate: null,
};

export function ItemForm({
  mode,
  initialValues = EMPTY_VALUES,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  initialValues?: ItemFormInitialValues;
  submitLabel: string;
  onSubmit: (values: ItemFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(String(initialValues.quantity));
  const [purchasePrice, setPurchasePrice] = useState(
    initialValues.purchasePrice != null ? String(initialValues.purchasePrice) : ''
  );
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

  const isEditMode = mode === 'edit';

  function resetFields() {
    setName(initialValues.name);
    setQuantity(String(initialValues.quantity));
    setPurchasePrice(initialValues.purchasePrice != null ? String(initialValues.purchasePrice) : '');
    setUnit(initialValues.unit);
    setStorageLocation(initialValues.storageLocation);
    setIsProduce(initialValues.isProduce);
    setManualExpirationDate(initialValues.expirationDate ?? '');
    setShowAdvanced(initialValues.notifyDaysOverride != null);
    setNotifyDaysOverride(
      initialValues.notifyDaysOverride != null ? String(initialValues.notifyDaysOverride) : ''
    );
  }

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
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
      });
      // Add mode only: clear the fields so a second accidental submit can't
      // create a duplicate row. The edit form is about to close (Fix 1), so
      // resetting it there would just flash the old values on the way out.
      if (!isEditMode) resetFields();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ ...cardStyle, display: 'grid', gap: 20, padding: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: color.foreground }}>
          {isEditMode ? 'Edit item' : 'Add a pantry item'}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: color.mutedForeground }}>
          {isEditMode ? 'Update the details below.' : 'Track what you have and when it expires.'}
        </p>
      </div>

      <label style={labelStyle}>
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Strawberries"
          style={inputStyle}
        />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label style={{ ...labelStyle, flex: '1 1 90px', maxWidth: 140 }}>
          Quantity
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
        <label style={{ ...labelStyle, flex: '1 1 110px', maxWidth: 160 }}>
          Price (₱, optional)
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: '1 1 120px' }}>
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '1 1 140px' }}>
          Storage
          <select value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} style={inputStyle}>
            {STORAGE_LOCATION_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 12,
          background: color.muted,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          padding: 16,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isProduce}
            onChange={(e) => handleProduceToggle(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: color.primary, cursor: 'pointer', flexShrink: 0 }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: color.foreground }}>Produce (perishable)</span>
        </label>

        {isProduce ? (
          <div style={labelStyle}>
            Expires
            <div style={{ ...inputStyle, background: color.card, color: color.mutedForeground }}>
              {computedProduceExpiry} <span style={{ color: color.mutedForeground }}>(auto — 7 days after purchase)</span>
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
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ ...buttonStyle('ghost'), display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}
        >
          <span style={{ fontSize: 11, transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}>
            ▸
          </span>
          Advanced options
        </button>
        {showAdvanced && (
          <label style={{ ...labelStyle, marginTop: 12 }}>
            Custom reminder (days before expiry)
            <input
              type="number"
              min="0"
              placeholder="Use household default"
              value={notifyDaysOverride}
              onChange={(e) => setNotifyDaysOverride(e.target.value)}
              style={inputStyle}
            />
            <span style={{ fontSize: 12, color: color.mutedForeground, fontWeight: 400 }}>
              Leave blank to use your household&apos;s default reminder timing.
            </span>
          </label>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '10px 14px',
            borderRadius: radius.sm,
            background: color.destructiveBg,
            color: color.destructive,
            fontSize: 13,
          }}
        >
          {error}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          paddingTop: 16,
          borderTop: `1px solid ${color.border}`,
        }}
      >
        {onCancel && (
          <button type="button" onClick={onCancel} style={buttonStyle('secondary')}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
