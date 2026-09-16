/**
 * Formats a bare ISO `YYYY-MM-DD` date (as stored in
 * `pantry_items.expiration_date`) into a short human-readable form, e.g.
 * "Sep 23, 2026". Parsed as UTC midnight to match `daysUntil`'s convention,
 * so the same date string always renders the same day regardless of the
 * viewer's local timezone.
 */
export function formatExpiryDate(dateStr: string | null): string {
  if (!dateStr) return '';

  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
