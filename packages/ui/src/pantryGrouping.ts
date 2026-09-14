import { getExpiryBadgeStatus } from './expiryStatus';

export interface GroupableItem {
  id: string;
  storageLocation: string;
  daysUntilExpiry: number | null;
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
      const expiringSoonCount = groupItems.filter((item) => {
        const status = getExpiryBadgeStatus(item.daysUntilExpiry);
        return status === 'critical' || status === 'warning';
      }).length;
      return { location, itemIds: groupItems.map((item) => item.id), expiringSoonCount };
    });
}
