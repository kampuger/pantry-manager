const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Whole days from today until `dateStr` (a bare ISO `YYYY-MM-DD` date, as
 * stored in `pantry_items.expiration_date`). Returns `null` for a missing or
 * unparseable date; a negative result means the date has already passed.
 *
 * Both the target date and "today" are normalized to UTC midnight before
 * diffing. A naive `new Date(dateStr).getTime() - Date.now()` parses the bare
 * date as UTC midnight but compares it against the current *instant*, so the
 * fractional part of the caller's day leaks into the result and the count is
 * off by one for anyone not sitting at UTC. "Today" is taken from the same
 * UTC calendar day the rest of the codebase already uses when it writes dates
 * (see `computeExpiryDate` and `addPantryItem`'s `purchase_date`), so the
 * value a freshly-added item reads back is consistent with the one written.
 */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;

  const target = Date.parse(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;

  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - today) / MS_PER_DAY);
}
