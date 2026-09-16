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
      // 'expired' is deliberately excluded: the header pill reads "N expiring
      // soon", which is a call to use those items before they go. Items that
      // are already past their date can no longer be saved, and each one
      // already carries its own "Expired" badge on the card.
      const expiringSoonCount = groupItems.filter((item) => {
        const status = getExpiryBadgeStatus(item.daysUntilExpiry, item.warningThresholdDays);
        return status === 'warning';
      }).length;
      return { location, itemIds: groupItems.map((item) => item.id), expiringSoonCount };
    });
}
