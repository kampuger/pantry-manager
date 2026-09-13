export interface ParsedIngredientLine {
  quantity: number | null;
  unit: string | null;
  name: string;
}

const UNIT_ALIASES: Record<string, string> = {
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  lb: 'lbs', lbs: 'lbs', pound: 'lbs', pounds: 'lbs',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs',
  pack: 'packs', packs: 'packs',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  cup: 'cups', cups: 'cups',
  stick: 'stick', sticks: 'stick',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
};

export function parseIngredientLine(rawLine: string): ParsedIngredientLine {
  const line = rawLine.trim();
  const match = line.match(/^(\d+\/\d+|\d+(?:\.\d+)?)\s+([a-zA-Z]+)?\.?\s*(.+)$/);

  if (!match) {
    return { quantity: null, unit: null, name: line };
  }

  const [, qtyToken, unitToken, rest] = match;
  const quantity = qtyToken.includes('/')
    ? (() => {
        const [num, den] = qtyToken.split('/').map(Number);
        return num / den;
      })()
    : parseFloat(qtyToken);

  const normalizedUnit = unitToken ? UNIT_ALIASES[unitToken.toLowerCase()] : undefined;

  if (unitToken && !normalizedUnit) {
    return { quantity, unit: null, name: `${unitToken} ${rest}`.trim() };
  }

  return { quantity, unit: normalizedUnit ?? null, name: rest.trim() };
}
