import { getExpiryBadgeStatus } from './expiryStatus';

export interface GroupableItem {
  id: string;
  storageLocation: string;
  daysUntilExpiry: number | null;
  /** This item's resolved notify threshold — see `resolveNotifyThreshold` in `@pantry/core`. */
  warningThresholdDays: number;
}

export interface LocationGroup {
  location: string;
  itemIds: string[];
  expiringSoonCount: number;
  expiredCount: number;
}

export function groupItemsByLocation(
  items: GroupableItem[],
  locationOrder: readonly string[]
): LocationGroup[] {
  const byLocation = new Map<string, GroupableItem[]>();
  for (const item of items) {
    const bucket = byLocation.get(item.storageLocation) ?? [];
    bucket.push(item);
    byLocation.set(item.storageLocation, bucket);
  }

  return locationOrder
    .filter((location) => byLocation.has(location))
    .map((location) => {
      const groupItems = byLocation.get(location)!;
      let expiringSoonCount = 0;
      let expiredCount = 0;
      for (const item of groupItems) {
        const status = getExpiryBadgeStatus(item.daysUntilExpiry, item.warningThresholdDays);
        if (status === 'warning') expiringSoonCount++;
        else if (status === 'expired') expiredCount++;
      }
      return { location, itemIds: groupItems.map((item) => item.id), expiringSoonCount, expiredCount };
    });
}
