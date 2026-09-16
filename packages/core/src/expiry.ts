export interface ComputeExpiryDateInput {
  isProduce: boolean;
  /** ISO yyyy-mm-dd; defaults to today (UTC) when isProduce is true and this is omitted. */
  purchaseDate?: string;
  /** Required when isProduce is false. */
  manualDate?: string | null;
}

export function computeExpiryDate(input: ComputeExpiryDateInput): string {
  if (input.isProduce) {
    const base = input.purchaseDate ?? new Date().toISOString().slice(0, 10);
    return addDays(base, 7);
  }
  if (!input.manualDate) {
    throw new Error('manualDate is required for non-produce items');
  }
  return input.manualDate;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface NotifyThresholdItem {
  isProduce: boolean;
  /** Per-item override; null means "inherit the household default for this item's produce/non-produce type" — mirrors refresh_household_reminders()'s eligibility SQL. */
  notifyDaysBeforeExpiry: number | null;
}

export interface HouseholdNotifyDefaults {
  notifyDaysProduce: number;
  notifyDaysNonproduce: number;
}

/** The number of days-before-expiry that should trigger a warning for this
 * item — a per-item override if set, otherwise the household's default for
 * its produce/non-produce type. */
export function resolveNotifyThreshold(item: NotifyThresholdItem, household: HouseholdNotifyDefaults): number {
  if (item.notifyDaysBeforeExpiry !== null) return item.notifyDaysBeforeExpiry;
  return item.isProduce ? household.notifyDaysProduce : household.notifyDaysNonproduce;
}
