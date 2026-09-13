export type FreshProduceCategory =
  | 'meat'
  | 'fish'
  | 'vegetables'
  | 'fruit'
  | 'dairy'
  | 'protein';

export function isFreshProduceCategory(category: string): boolean {
  const normalized = category.toLowerCase();
  return [
    'meat',
    'fish',
    'vegetables',
    'vegetable',
    'fruit',
    'fruits',
    'dairy',
    'protein',
    'seafood',
    'produce',
  ].includes(normalized);
}

export function getFreshnessFlag(
  lastRestockIso: string,
  category: string,
  now: Date = new Date()
): boolean {
  if (!isFreshProduceCategory(category)) return false;

  const restockDate = new Date(lastRestockIso);
  if (Number.isNaN(restockDate.getTime())) return false;

  const millisPerDay = 1000 * 60 * 60 * 24;
  const ageDays = (now.getTime() - restockDate.getTime()) / millisPerDay;

  return ageDays > 7;
}
