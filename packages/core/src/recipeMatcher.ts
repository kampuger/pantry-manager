import { parseIngredientLine } from './ingredientParser';
import { compareAvailability, type AvailabilityStatus } from './unitConversion';

export interface PantryStockItem {
  name: string;
  quantity: number;
  unit: string;
}

export interface MatchedIngredient {
  rawLine: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  status: AvailabilityStatus;
  matchedStock?: PantryStockItem;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function findMatch(name: string, stock: PantryStockItem[]): PantryStockItem | undefined {
  const normalized = normalize(name);
  if (!normalized) return undefined;

  return stock.find((item) => {
    const stockName = normalize(item.name);
    return stockName === normalized || stockName.includes(normalized) || normalized.includes(stockName);
  });
}

export function matchRecipeIngredients(recipeText: string, stock: PantryStockItem[]): MatchedIngredient[] {
  const lines = recipeText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((rawLine) => {
    const { quantity, unit, name } = parseIngredientLine(rawLine);
    const matchedStock = findMatch(name, stock);

    if (!matchedStock) {
      return { rawLine, name, quantity, unit, status: 'MISSING' as const };
    }

    if (quantity !== null && unit !== null) {
      const status = compareAvailability(quantity, unit, matchedStock.quantity, matchedStock.unit, name);
      return { rawLine, name, quantity, unit, status, matchedStock };
    }

    // No parseable quantity/unit on this recipe line (e.g. "salt to taste") —
    // presence in stock at all counts as available.
    const status: AvailabilityStatus = matchedStock.quantity > 0 ? 'FULLY_AVAILABLE' : 'MISSING';
    return { rawLine, name, quantity, unit, status, matchedStock };
  });
}
