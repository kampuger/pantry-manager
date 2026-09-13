export type MovementEventType =
  | 'PURCHASED'
  | 'CONSUMED'
  | 'EXPIRED'
  | 'SPOILED_DISCARDED'
  | 'MANUAL_ADJUST';

export interface MovementLogRecord {
  eventType: MovementEventType;
  valueDelta: number | null;
}

export function computeConsumedValue(logs: MovementLogRecord[]): number {
  return logs
    .filter((m) => m.eventType === 'CONSUMED')
    .reduce((sum, m) => sum + (m.valueDelta ?? 0), 0);
}

export function computeWastedValue(logs: MovementLogRecord[]): number {
  return logs
    .filter((m) => m.eventType === 'EXPIRED' || m.eventType === 'SPOILED_DISCARDED')
    .reduce((sum, m) => sum + (m.valueDelta ?? 0), 0);
}

export function computePantryEfficiency(logs: MovementLogRecord[]): number | null {
  const consumed = computeConsumedValue(logs);
  const wasted = computeWastedValue(logs);
  const total = consumed + wasted;
  if (total === 0) return null;
  return (consumed / total) * 100;
}

export function computeCategorySpend(
  items: Array<{ categoryId: string; purchasePrice: number }>
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.categoryId] = (acc[item.categoryId] ?? 0) + item.purchasePrice;
    return acc;
  }, {});
}

export function computeTripAverage(trips: Array<{ totalSpent: number }>): number | null {
  if (trips.length === 0) return null;
  return trips.reduce((sum, t) => sum + t.totalSpent, 0) / trips.length;
}
