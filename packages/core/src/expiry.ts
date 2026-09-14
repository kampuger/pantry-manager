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
