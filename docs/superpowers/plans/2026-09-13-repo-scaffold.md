# Pantry Tracker Repo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full monorepo skeleton for the Smart Household Pantry & Budget Tracker — shared business-logic packages (with real, tested code, not stubs), Supabase migrations, and bootstrapped Expo (mobile) and Next.js (web) apps wired to those packages — so the next phase of work is feature implementation inside an already-working, already-typed, already-tested structure.

**Architecture:** npm workspaces monorepo (`apps/*`, `packages/*`) sharing one TypeScript project reference base. Pure, platform-independent business logic (unit conversion, ingredient matching, financial formulas, currency formatting) lives in `packages/core` and is unit-tested with Jest. Platform-divergent code (OCR, push notifications) is isolated behind small interfaces in `packages/ocr` and `packages/notifications`, each with a `.native.ts` / `.web.ts` implementation pair. `apps/mobile` (Expo) and `apps/web` (Next.js + react-native-web) consume all shared packages as workspace dependencies. `supabase/migrations` holds the hand-authored DDL and RLS SQL as the single source of truth for schema.

**Tech Stack:** TypeScript 5, npm workspaces, Jest + ts-jest, Expo (managed workflow, blank-typescript template), Next.js (App Router) + react-native-web, `@supabase/supabase-js`, Supabase CLI migrations (plain SQL, no ORM).

**Spec:** [spec.md](../../../spec.md) — this plan implements Sections 1 (architecture), 2 (schema), 3 (algorithms), 5 (RLS) as working code; Sections 4 and 6 are structural targets that later feature-work plans will fill in against the scaffolded shell built here.

## Global Constraints

- All currency values are PHP and use `NUMERIC(12, 2)` in SQL and `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })` in TypeScript — never `FLOAT`/`REAL` for money (spec §2.1, §6).
- Zero paid services: no step in this plan may add a dependency that requires a paid tier to function locally or in CI (spec §1.3).
- Platform-divergent code (OCR, notifications) must be isolated behind an interface with `.native.ts`/`.web.ts` file-suffix resolution — consuming code never branches on `Platform.OS` for these concerns (spec §1.1, §3.1).
- No image or file buffer may be written to persistent storage anywhere in the OCR pipeline — cleanup happens in a `finally` block (spec §3.1, §6.3).
- Package names are scoped `@pantry/*` (`@pantry/core`, `@pantry/ocr`, `@pantry/notifications`, `@pantry/ui`, `@pantry/supabase-client`) — matches the import path already fixed in spec §3.1's code sample.

---

## File Structure

```
PantryManager/
├── package.json                      # npm workspaces root
├── tsconfig.base.json                # shared compiler options
├── .gitignore
├── apps/
│   ├── mobile/                       # Expo blank-typescript app
│   └── web/                          # Next.js App Router + react-native-web
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.js
│   │   └── src/
│   │       ├── unitConversion.ts     # spec §3.2
│   │       ├── unitConversion.test.ts
│   │       ├── ingredientParser.ts   # spec §3.2 (line parsing)
│   │       ├── ingredientParser.test.ts
│   │       ├── financial.ts          # spec §3.3
│   │       ├── financial.test.ts
│   │       ├── currency.ts           # formatPHP()
│   │       ├── currency.test.ts
│   │       └── index.ts
│   ├── ocr/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.js
│   │   └── src/
│   │       ├── types.ts              # IOcrProvider, OcrInput, OcrResult
│   │       ├── contract.test.ts      # compile/behavior contract test
│   │       ├── ocr.native.ts         # ML Kit / Apple Vision
│   │       └── ocr.web.ts            # Tesseract.js Web Worker
│   ├── notifications/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.js
│   │   └── src/
│   │       ├── types.ts              # INotificationProvider
│   │       ├── contract.test.ts
│   │       ├── notifications.native.ts
│   │       └── notifications.web.ts
│   ├── supabase-client/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.js
│   │   └── src/
│   │       ├── types.ts              # hand-written Database interface subset
│   │       ├── client.ts             # createSupabaseClient()
│   │       └── client.test.ts
│   └── ui/
│       ├── package.json
│       ├── tsconfig.json
│       ├── jest.config.js
│       └── src/
│           ├── expiryStatus.ts       # pure logic: getExpiryBadgeStatus()
│           ├── expiryStatus.test.ts
│           └── index.ts
└── supabase/
    └── migrations/
        ├── 20260913000001_initial_schema.sql
        ├── 20260913000002_rls_policies.sql
        └── 20260913000003_financial_view.sql
```

---

### Task 1: Monorepo root scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: npm workspaces glob (`apps/*`, `packages/*`) that every later task's package.json must sit inside to be picked up; `tsconfig.base.json` that every later `tsconfig.json` extends via `"extends": "../../tsconfig.base.json"`.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "pantry-tracker",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.expo/
.next/
*.log
.env
.env.local
.DS_Store
```

- [ ] **Step 4: Verify npm accepts the workspace config**

Run: `npm install`
Expected: completes without error and creates `package-lock.json` at the repo root (workspace globs matching zero packages yet is not an error).

- [ ] **Step 5: Initialize git and commit**

```bash
git init
git add package.json tsconfig.base.json .gitignore
git commit -m "chore: scaffold monorepo root (npm workspaces + base tsconfig)"
```

---

### Task 2: `@pantry/core` — unit conversion engine

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/jest.config.js`
- Create: `packages/core/src/unitConversion.ts`
- Test: `packages/core/src/unitConversion.test.ts`

**Interfaces:**
- Produces: `toCanonical(quantity: number, unit: string): { value: number; dimension: 'WEIGHT' | 'VOLUME' | 'DISCRETE' } | null` and `compareAvailability(requiredQty: number, requiredUnit: string, stockQty: number, stockUnit: string, ingredientName: string): 'FULLY_AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'MISSING'` — consumed directly by Task 4 (`index.ts` re-export) and by the future Recipe OCR Inspector feature.

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@pantry/core",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/core/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};
```

- [ ] **Step 4: Write the failing test**

```typescript
// packages/core/src/unitConversion.test.ts
import { toCanonical, compareAvailability } from './unitConversion';

describe('toCanonical', () => {
  it('converts weight units to grams', () => {
    expect(toCanonical(2, 'kg')).toEqual({ value: 2000, dimension: 'WEIGHT' });
    expect(toCanonical(1, 'lbs')).toEqual({ value: 453.592, dimension: 'WEIGHT' });
  });

  it('converts volume units to milliliters', () => {
    expect(toCanonical(2, 'tbsp')).toEqual({ value: 29.5736, dimension: 'VOLUME' });
  });

  it('leaves discrete units unconverted', () => {
    expect(toCanonical(3, 'pcs')).toEqual({ value: 3, dimension: 'DISCRETE' });
  });
});

describe('compareAvailability', () => {
  it('returns FULLY_AVAILABLE when stock covers the requirement in the same dimension', () => {
    expect(compareAvailability(500, 'g', 1, 'kg', 'flour')).toBe('FULLY_AVAILABLE');
  });

  it('returns PARTIALLY_AVAILABLE when stock is nonzero but insufficient', () => {
    expect(compareAvailability(2, 'kg', 500, 'g', 'flour')).toBe('PARTIALLY_AVAILABLE');
  });

  it('returns MISSING when stock is zero', () => {
    expect(compareAvailability(1, 'kg', 0, 'g', 'flour')).toBe('MISSING');
  });

  it('bridges volume to weight using a known ingredient density', () => {
    // 2 tbsp butter (~29.57 ml * 0.911 g/ml =~ 26.94 g) vs 1 lb (453.592 g) in stock
    expect(compareAvailability(2, 'tbsp', 1, 'lbs', 'butter')).toBe('FULLY_AVAILABLE');
  });

  it('returns MISSING when dimensions differ and no density is known', () => {
    expect(compareAvailability(2, 'tbsp', 1, 'lbs', 'unobtainium')).toBe('MISSING');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd packages/core && npx jest unitConversion`
Expected: FAIL with `Cannot find module './unitConversion'`.

- [ ] **Step 6: Write the implementation**

```typescript
// packages/core/src/unitConversion.ts
export type Dimension = 'WEIGHT' | 'VOLUME' | 'DISCRETE';

export type AvailabilityStatus = 'FULLY_AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'MISSING';

const WEIGHT_TO_GRAMS: Record<string, number> = {
  kg: 1000,
  g: 1,
  lbs: 453.592,
  oz: 28.3495,
};

const VOLUME_TO_ML: Record<string, number> = {
  L: 1000,
  ml: 1,
  cups: 236.588,
  tbsp: 14.7868,
  tsp: 4.92892,
};

// Density (g/ml) for common ingredients, enabling volume<->weight bridging.
// Extensible; falls back to "cannot compare" (MISSING) if absent.
export const INGREDIENT_DENSITY_G_PER_ML: Record<string, number> = {
  butter: 0.911,
  'cooking oil': 0.92,
  water: 1.0,
  milk: 1.03,
  flour: 0.593,
  sugar: 0.845,
};

function dimensionOf(unit: string): Dimension {
  if (unit in WEIGHT_TO_GRAMS) return 'WEIGHT';
  if (unit in VOLUME_TO_ML) return 'VOLUME';
  return 'DISCRETE';
}

export function toCanonical(
  quantity: number,
  unit: string
): { value: number; dimension: Dimension } | null {
  const dim = dimensionOf(unit);

  if (dim === 'WEIGHT') return { value: quantity * WEIGHT_TO_GRAMS[unit], dimension: 'WEIGHT' };
  if (dim === 'VOLUME') return { value: quantity * VOLUME_TO_ML[unit], dimension: 'VOLUME' };

  return { value: quantity, dimension: 'DISCRETE' };
}

export function compareAvailability(
  requiredQty: number,
  requiredUnit: string,
  stockQty: number,
  stockUnit: string,
  ingredientName: string
): AvailabilityStatus {
  const required = toCanonical(requiredQty, requiredUnit);
  const stock = toCanonical(stockQty, stockUnit);
  if (!required || !stock) return 'MISSING';

  let requiredInStockDimension = required.value;

  if (required.dimension !== stock.dimension) {
    const density = INGREDIENT_DENSITY_G_PER_ML[ingredientName.toLowerCase()];
    if (!density) return 'MISSING';

    requiredInStockDimension =
      required.dimension === 'VOLUME'
        ? required.value * density // ml -> g
        : required.value / density; // g -> ml
  }

  if (stock.value >= requiredInStockDimension) return 'FULLY_AVAILABLE';
  if (stock.value > 0) return 'PARTIALLY_AVAILABLE';
  return 'MISSING';
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/core && npx jest unitConversion`
Expected: PASS, all 7 assertions green.

- [ ] **Step 8: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/jest.config.js packages/core/src/unitConversion.ts packages/core/src/unitConversion.test.ts
git commit -m "feat(core): add unit conversion and availability matching engine"
```

---

### Task 3: `@pantry/core` — ingredient line parser

**Files:**
- Create: `packages/core/src/ingredientParser.ts`
- Test: `packages/core/src/ingredientParser.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `parseIngredientLine(rawLine: string): { quantity: number | null; unit: string | null; name: string }` — the normalized `unit` value is one of the same unit-string keys `toCanonical` (Task 2) understands, so downstream matching can chain `parseIngredientLine` output straight into `compareAvailability`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/ingredientParser.test.ts
import { parseIngredientLine } from './ingredientParser';

describe('parseIngredientLine', () => {
  it('parses a whole-number quantity with a known unit', () => {
    expect(parseIngredientLine('2 tbsp butter')).toEqual({
      quantity: 2,
      unit: 'tbsp',
      name: 'butter',
    });
  });

  it('parses a fractional quantity and normalizes a unit alias', () => {
    expect(parseIngredientLine('1/2 cup flour')).toEqual({
      quantity: 0.5,
      unit: 'cups',
      name: 'flour',
    });
  });

  it('parses discrete piece counts', () => {
    expect(parseIngredientLine('3 pcs onion')).toEqual({
      quantity: 3,
      unit: 'pcs',
      name: 'onion',
    });
  });

  it('returns null quantity/unit for lines with no leading number', () => {
    expect(parseIngredientLine('salt to taste')).toEqual({
      quantity: null,
      unit: null,
      name: 'salt to taste',
    });
  });

  it('folds an unrecognized token after the number into the name', () => {
    expect(parseIngredientLine('5 large eggs')).toEqual({
      quantity: 5,
      unit: null,
      name: 'large eggs',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx jest ingredientParser`
Expected: FAIL with `Cannot find module './ingredientParser'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/ingredientParser.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx jest ingredientParser`
Expected: PASS, all 5 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingredientParser.ts packages/core/src/ingredientParser.test.ts
git commit -m "feat(core): add ingredient line parser"
```

---

### Task 4: `@pantry/core` — financial spoilage formulas

**Files:**
- Create: `packages/core/src/financial.ts`
- Test: `packages/core/src/financial.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (operates on plain record shapes, decoupled from the DB client so it can be unit-tested without Supabase).
- Produces: `computeConsumedValue`, `computeWastedValue`, `computePantryEfficiency`, `computeCategorySpend`, `computeTripAverage` — all consumed by the future Financial Analytics dashboard screens in `apps/mobile` and `apps/web`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/financial.test.ts
import {
  computeConsumedValue,
  computeWastedValue,
  computePantryEfficiency,
  computeCategorySpend,
  computeTripAverage,
  type MovementLogRecord,
} from './financial';

describe('financial formulas', () => {
  const logs: MovementLogRecord[] = [
    { eventType: 'CONSUMED', valueDelta: 100 },
    { eventType: 'CONSUMED', valueDelta: 50 },
    { eventType: 'EXPIRED', valueDelta: 30 },
    { eventType: 'SPOILED_DISCARDED', valueDelta: 20 },
    { eventType: 'PURCHASED', valueDelta: null },
  ];

  it('sums consumed value', () => {
    expect(computeConsumedValue(logs)).toBe(150);
  });

  it('sums wasted value across EXPIRED and SPOILED_DISCARDED', () => {
    expect(computeWastedValue(logs)).toBe(50);
  });

  it('computes pantry efficiency as a percentage', () => {
    expect(computePantryEfficiency(logs)).toBeCloseTo(75, 5); // 150 / 200 * 100
  });

  it('returns null efficiency when no value has moved', () => {
    expect(computePantryEfficiency([])).toBeNull();
  });

  it('groups category spend by categoryId', () => {
    const items = [
      { categoryId: 'meat', purchasePrice: 200 },
      { categoryId: 'meat', purchasePrice: 100 },
      { categoryId: 'dairy', purchasePrice: 50 },
    ];
    expect(computeCategorySpend(items)).toEqual({ meat: 300, dairy: 50 });
  });

  it('averages trip spend, or returns null for zero trips', () => {
    expect(computeTripAverage([{ totalSpent: 500 }, { totalSpent: 300 }])).toBe(400);
    expect(computeTripAverage([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx jest financial`
Expected: FAIL with `Cannot find module './financial'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/financial.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx jest financial`
Expected: PASS, all 6 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/financial.ts packages/core/src/financial.test.ts
git commit -m "feat(core): add financial spoilage and efficiency formulas"
```

---

### Task 5: `@pantry/core` — currency formatting + package index

**Files:**
- Create: `packages/core/src/currency.ts`
- Test: `packages/core/src/currency.test.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `formatPHP(amount: number): string`, and a barrel `index.ts` re-exporting every symbol from Tasks 2–5 — this is the single import surface (`import { formatPHP, compareAvailability, ... } from '@pantry/core'`) that `apps/mobile`, `apps/web`, and `packages/ui` (Task 8) will use.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/currency.test.ts
import { formatPHP } from './currency';

describe('formatPHP', () => {
  it('formats a whole number as PHP currency', () => {
    expect(formatPHP(12345.67)).toBe('₱12,345.67');
  });

  it('formats zero correctly', () => {
    expect(formatPHP(0)).toBe('₱0.00');
  });

  it('formats negative values with a leading minus before the symbol', () => {
    expect(formatPHP(-50)).toBe('-₱50.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx jest currency`
Expected: FAIL with `Cannot find module './currency'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/currency.ts
const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPHP(amount: number): string {
  return PHP_FORMATTER.format(amount).replace('PHP', '₱').replace(/\s/g, '');
}
```

> Note: Node's ICU data renders `en-PH`/`PHP` as `"₱12,345.67"` directly on most modern Node builds, but the `.replace('PHP', '₱')` guards against ICU variants that render the currency code as the literal string `PHP` with a space instead of the symbol.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx jest currency`
Expected: PASS. If the exact string still doesn't match on your Node's ICU build, run `node -e "console.log(new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(12345.67))"` to see the raw output and adjust the `.replace(...)` chain to normalize it to `₱12,345.67` — do not change the test's expected value, since that value is the UI contract from spec §4.3.

- [ ] **Step 5: Create the package barrel**

```typescript
// packages/core/src/index.ts
export * from './unitConversion';
export * from './ingredientParser';
export * from './financial';
export * from './currency';
```

- [ ] **Step 6: Run the full `core` package test suite**

Run: `cd packages/core && npx jest`
Expected: PASS, 4 test files, 21 total assertions green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/currency.ts packages/core/src/currency.test.ts packages/core/src/index.ts
git commit -m "feat(core): add PHP currency formatter and package barrel export"
```

---

### Task 6: `@pantry/ocr` — ephemeral OCR provider interface + adapters

**Files:**
- Create: `packages/ocr/package.json`
- Create: `packages/ocr/tsconfig.json`
- Create: `packages/ocr/jest.config.js`
- Create: `packages/ocr/src/types.ts`
- Test: `packages/ocr/src/contract.test.ts`
- Create: `packages/ocr/src/ocr.native.ts`
- Create: `packages/ocr/src/ocr.web.ts`

**Interfaces:**
- Produces: `IOcrProvider.extractText(input: OcrInput): Promise<OcrResult>`, `OcrInput = { kind: 'mobile-uri'; uri: string } | { kind: 'web-file'; file: File }`, `OcrResult = { rawText: string; confidence: number }`. `apps/mobile` imports `ocrProvider` from `@pantry/ocr` and gets `ocr.native.ts` via Metro's platform-suffix resolution; `apps/web` gets `ocr.web.ts` via webpack's same convention. Neither app ever imports the `.native`/`.web` files directly.
- Consumes: nothing from other tasks — this package has no dependency on `@pantry/core`.

> The `.native.ts`/`.web.ts` adapters call real device/browser APIs (ML Kit, Apple Vision, Tesseract.js) that cannot run inside a plain Node/Jest process. This task therefore unit-tests the **interface contract** with an in-memory fake provider (proving the types are usable end-to-end) and creates the real adapters as reviewable, spec-accurate implementations whose runtime behavior is verified manually once `apps/mobile` (Task 10) and `apps/web` (Task 11) exist.

- [ ] **Step 1: Create `packages/ocr/package.json`**

```json
{
  "name": "@pantry/ocr",
  "version": "0.1.0",
  "private": true,
  "main": "src/ocr.native.ts",
  "browser": "src/ocr.web.ts",
  "types": "src/types.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "expo-file-system": "~17.0.1",
    "@react-native-ml-kit/text-recognition": "^1.5.2",
    "tesseract.js": "^5.1.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/ocr/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/ocr/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'ocr.native.ts', 'ocr.web.ts'],
};
```

- [ ] **Step 4: Write `packages/ocr/src/types.ts`**

```typescript
export interface OcrResult {
  rawText: string;
  confidence: number;
}

export interface IOcrProvider {
  extractText(input: OcrInput): Promise<OcrResult>;
}

export type OcrInput =
  | { kind: 'mobile-uri'; uri: string }
  | { kind: 'web-file'; file: File };
```

- [ ] **Step 5: Write the failing contract test**

```typescript
// packages/ocr/src/contract.test.ts
import type { IOcrProvider, OcrInput, OcrResult } from './types';

class FakeOcrProvider implements IOcrProvider {
  public cleanupCalled = false;

  async extractText(input: OcrInput): Promise<OcrResult> {
    try {
      if (input.kind === 'mobile-uri') {
        return { rawText: `text-from:${input.uri}`, confidence: 1 };
      }
      return { rawText: `text-from:${input.file.name}`, confidence: 0.9 };
    } finally {
      this.cleanupCalled = true;
    }
  }
}

describe('IOcrProvider contract', () => {
  it('accepts a mobile-uri input and resolves an OcrResult', async () => {
    const provider = new FakeOcrProvider();
    const result = await provider.extractText({ kind: 'mobile-uri', uri: 'file:///tmp/x.jpg' });
    expect(result.rawText).toBe('text-from:file:///tmp/x.jpg');
    expect(provider.cleanupCalled).toBe(true);
  });

  it('accepts a web-file input and resolves an OcrResult', async () => {
    const provider = new FakeOcrProvider();
    const fakeFile = { name: 'recipe.png' } as File;
    const result = await provider.extractText({ kind: 'web-file', file: fakeFile });
    expect(result.rawText).toBe('text-from:recipe.png');
    expect(provider.cleanupCalled).toBe(true);
  });

  it('runs cleanup even when extraction throws', async () => {
    class ThrowingProvider implements IOcrProvider {
      public cleanupCalled = false;
      async extractText(): Promise<OcrResult> {
        try {
          throw new Error('blurry image');
        } finally {
          this.cleanupCalled = true;
        }
      }
    }
    const provider = new ThrowingProvider();
    await expect(provider.extractText({ kind: 'mobile-uri', uri: 'x' })).rejects.toThrow(
      'blurry image'
    );
    expect(provider.cleanupCalled).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/ocr && npx jest contract`
Expected: FAIL with `Cannot find module './types'`.

- [ ] **Step 7: Run test to verify it passes** (the `types.ts` file from Step 4 already exists, so this simply confirms the contract compiles and passes)

Run: `cd packages/ocr && npx jest contract`
Expected: PASS, 3 assertions green.

- [ ] **Step 8: Create the native adapter**

```typescript
// packages/ocr/src/ocr.native.ts
import * as FileSystem from 'expo-file-system';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { IOcrProvider, OcrInput, OcrResult } from './types';

export const ocrProvider: IOcrProvider = {
  async extractText(input: OcrInput): Promise<OcrResult> {
    if (input.kind !== 'mobile-uri') {
      throw new Error('Native OCR provider requires a mobile-uri input');
    }

    const { uri } = input;

    try {
      const recognitionResult = await TextRecognition.recognize(uri);
      return {
        rawText: recognitionResult.text,
        confidence: 1.0,
      };
    } finally {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    }
  },
};
```

- [ ] **Step 9: Create the web adapter**

```typescript
// packages/ocr/src/ocr.web.ts
import { createWorker, type Worker } from 'tesseract.js';
import type { IOcrProvider, OcrInput, OcrResult } from './types';

let workerSingleton: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerSingleton) {
    workerSingleton = await createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
    });
  }
  return workerSingleton;
}

export const ocrProvider: IOcrProvider = {
  async extractText(input: OcrInput): Promise<OcrResult> {
    if (input.kind !== 'web-file') {
      throw new Error('Web OCR provider requires a web-file input');
    }

    const { file } = input;
    let objectUrl: string | null = null;

    try {
      objectUrl = URL.createObjectURL(file);
      const worker = await getWorker();
      const { data } = await worker.recognize(objectUrl);
      return {
        rawText: data.text,
        confidence: data.confidence / 100,
      };
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  },
};
```

- [ ] **Step 10: Commit**

```bash
git add packages/ocr
git commit -m "feat(ocr): add IOcrProvider contract, native ML Kit adapter, and web Tesseract.js adapter"
```

---

### Task 7: `@pantry/notifications` — push registration provider interface + adapters

**Files:**
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/tsconfig.json`
- Create: `packages/notifications/jest.config.js`
- Create: `packages/notifications/src/types.ts`
- Test: `packages/notifications/src/contract.test.ts`
- Create: `packages/notifications/src/notifications.native.ts`
- Create: `packages/notifications/src/notifications.web.ts`

**Interfaces:**
- Produces: `INotificationProvider.requestPermission(): Promise<boolean>`, `INotificationProvider.registerForPush(): Promise<string | null>`. Consumed by `apps/mobile`/`apps/web` on first-run to obtain a push token, which the app then writes to a (future) `device_push_tokens` table for the Edge Function dispatcher described in spec §1.5/§6.5.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Create `packages/notifications/package.json`**

```json
{
  "name": "@pantry/notifications",
  "version": "0.1.0",
  "private": true,
  "main": "src/notifications.native.ts",
  "browser": "src/notifications.web.ts",
  "types": "src/types.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "expo-notifications": "~0.29.14",
    "expo-device": "~7.0.3"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/notifications/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/notifications/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'notifications.native.ts', 'notifications.web.ts'],
};
```

- [ ] **Step 4: Write `packages/notifications/src/types.ts`**

```typescript
export interface INotificationProvider {
  requestPermission(): Promise<boolean>;
  registerForPush(): Promise<string | null>;
}
```

- [ ] **Step 5: Write the failing contract test**

```typescript
// packages/notifications/src/contract.test.ts
import type { INotificationProvider } from './types';

class FakeNotificationProvider implements INotificationProvider {
  constructor(private granted: boolean) {}

  async requestPermission(): Promise<boolean> {
    return this.granted;
  }

  async registerForPush(): Promise<string | null> {
    if (!this.granted) return null;
    return 'ExponentPushToken[fake-token]';
  }
}

describe('INotificationProvider contract', () => {
  it('returns a token when permission is granted', async () => {
    const provider = new FakeNotificationProvider(true);
    expect(await provider.requestPermission()).toBe(true);
    expect(await provider.registerForPush()).toBe('ExponentPushToken[fake-token]');
  });

  it('returns null token when permission is denied', async () => {
    const provider = new FakeNotificationProvider(false);
    expect(await provider.requestPermission()).toBe(false);
    expect(await provider.registerForPush()).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails, then passes**

Run: `cd packages/notifications && npx jest contract`
Expected: first run fails on missing `./types`; after Step 4's file exists it passes with 2 assertions green.

- [ ] **Step 7: Create the native adapter**

```typescript
// packages/notifications/src/notifications.native.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { INotificationProvider } from './types';

export const notificationProvider: INotificationProvider = {
  async requestPermission(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  },

  async registerForPush(): Promise<string | null> {
    if (!Device.isDevice) return null; // push tokens are not available on simulators

    const granted = await this.requestPermission();
    if (!granted) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    return token;
  },
};
```

- [ ] **Step 8: Create the web adapter**

```typescript
// packages/notifications/src/notifications.web.ts
import type { INotificationProvider } from './types';

export const notificationProvider: INotificationProvider = {
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;

    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  async registerForPush(): Promise<string | null> {
    const granted = await this.requestPermission();
    if (!granted) return null;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? JSON.stringify(subscription) : null;
  },
};
```

- [ ] **Step 9: Commit**

```bash
git add packages/notifications
git commit -m "feat(notifications): add INotificationProvider contract, Expo push adapter, and web push adapter"
```

---

### Task 8: `@pantry/ui` — expiry badge status logic

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/jest.config.js`
- Create: `packages/ui/src/expiryStatus.ts`
- Test: `packages/ui/src/expiryStatus.test.ts`
- Create: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: nothing from other tasks (kept dependency-free so it's trivially unit-testable; the visual `<ExpiryBadge>` React component that wraps this logic is scoped to the feature-implementation phase, once `apps/mobile`/`apps/web` share a component-testing setup).
- Produces: `getExpiryBadgeStatus(daysUntilExpiry: number | null): 'critical' | 'warning' | 'ok' | 'unknown'` — consumed by the Pantry Inventory screen in both apps to color-code expiry chips (spec §4.2, §4.3).

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@pantry/ui",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/ui/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};
```

- [ ] **Step 4: Write the failing test**

```typescript
// packages/ui/src/expiryStatus.test.ts
import { getExpiryBadgeStatus } from './expiryStatus';

describe('getExpiryBadgeStatus', () => {
  it('returns "critical" for items expiring within 2 days', () => {
    expect(getExpiryBadgeStatus(2)).toBe('critical');
    expect(getExpiryBadgeStatus(0)).toBe('critical');
    expect(getExpiryBadgeStatus(-1)).toBe('critical'); // already expired
  });

  it('returns "warning" for items expiring within 3-7 days', () => {
    expect(getExpiryBadgeStatus(3)).toBe('warning');
    expect(getExpiryBadgeStatus(7)).toBe('warning');
  });

  it('returns "ok" for items expiring in more than 7 days', () => {
    expect(getExpiryBadgeStatus(8)).toBe('ok');
    expect(getExpiryBadgeStatus(365)).toBe('ok');
  });

  it('returns "unknown" when no expiration date is set', () => {
    expect(getExpiryBadgeStatus(null)).toBe('unknown');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd packages/ui && npx jest expiryStatus`
Expected: FAIL with `Cannot find module './expiryStatus'`.

- [ ] **Step 6: Write the implementation**

```typescript
// packages/ui/src/expiryStatus.ts
export type ExpiryBadgeStatus = 'critical' | 'warning' | 'ok' | 'unknown';

export function getExpiryBadgeStatus(daysUntilExpiry: number | null): ExpiryBadgeStatus {
  if (daysUntilExpiry === null) return 'unknown';
  if (daysUntilExpiry <= 2) return 'critical';
  if (daysUntilExpiry <= 7) return 'warning';
  return 'ok';
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/ui && npx jest expiryStatus`
Expected: PASS, all 4 test cases (9 assertions) green.

- [ ] **Step 8: Create the package barrel**

```typescript
// packages/ui/src/index.ts
export * from './expiryStatus';
```

- [ ] **Step 9: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add expiry badge status classification logic"
```

---

### Task 9: Supabase schema, RLS, and view migrations

**Files:**
- Create: `supabase/migrations/20260913000001_initial_schema.sql`
- Create: `supabase/migrations/20260913000002_rls_policies.sql`
- Create: `supabase/migrations/20260913000003_financial_view.sql`

**Interfaces:**
- Produces: the full Postgres schema (`households`, `household_members`, `item_categories`, `pantry_items`, `inventory_movement_logs`, `recipes`, `recipe_ingredients`, `grocery_trips`, `grocery_list_entries`) plus RLS policies and the `v_household_financials` view — this is what `packages/supabase-client` (Task 10) types against and what a real Supabase project is provisioned with.
- Consumes: nothing — this is pure SQL, independent of the TypeScript packages.

- [ ] **Step 1: Create `supabase/migrations/20260913000001_initial_schema.sql`**

```sql
-- =========================================================
-- EXTENSIONS
-- =========================================================
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";
create extension if not exists "pg_trgm";

-- =========================================================
-- ENUM TYPES
-- =========================================================
create type household_role as enum ('OWNER', 'ADMIN', 'MEMBER');

create type storage_location as enum ('FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER', 'OTHER');

create type unit_of_measure as enum (
  'kg', 'g', 'lbs', 'pcs', 'packs', 'tbsp', 'tsp', 'ml', 'L', 'cups', 'stick', 'oz'
);

create type movement_event_type as enum (
  'PURCHASED', 'CONSUMED', 'EXPIRED', 'SPOILED_DISCARDED', 'MANUAL_ADJUST'
);

create type ingredient_availability_status as enum (
  'FULLY_AVAILABLE', 'PARTIALLY_AVAILABLE', 'MISSING'
);

-- =========================================================
-- HOUSEHOLDS
-- =========================================================
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekly_shopping_day smallint check (weekly_shopping_day between 0 and 6),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column households.weekly_shopping_day is 'ISO-ish day index used by the Weekly Perishable Monitor cron';

-- =========================================================
-- HOUSEHOLD MEMBERS
-- =========================================================
create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role household_role not null default 'MEMBER',
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index idx_household_members_user on household_members(user_id);
create index idx_household_members_household on household_members(household_id);

-- =========================================================
-- ITEM CATEGORIES
-- =========================================================
create table item_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  icon_key text,
  is_system_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index idx_item_categories_household on item_categories(household_id);

-- =========================================================
-- RECIPES (created before pantry_items/movement logs since they FK to it)
-- =========================================================
create table recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  source_type text check (source_type in ('OCR_IMAGE', 'PASTED_TEXT', 'URL')),
  raw_extracted_text text check (char_length(raw_extracted_text) <= 10000),
  servings smallint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_recipes_household on recipes(household_id);

-- =========================================================
-- GROCERY TRIPS (created before pantry_items since it FKs to it)
-- =========================================================
create table grocery_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  store_name text,
  trip_date date not null default current_date,
  total_spent numeric(12, 2) not null default 0 check (total_spent >= 0),
  logged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_grocery_trips_household_date on grocery_trips(household_id, trip_date desc);

-- =========================================================
-- PANTRY ITEMS
-- =========================================================
create table pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category_id uuid references item_categories(id) on delete set null,
  grocery_trip_id uuid references grocery_trips(id) on delete set null,
  name text not null,
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit unit_of_measure not null,
  storage_location storage_location not null default 'PANTRY',
  purchase_date date,
  expiration_date date,
  purchase_price numeric(12, 2) check (purchase_price >= 0),
  replenishment_threshold numeric(12, 3) default 0,
  notify_on_low_stock boolean not null default true,
  notify_days_before_expiry smallint default 3,
  is_archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_pantry_items_household on pantry_items(household_id) where is_archived = false;
create index idx_pantry_items_expiration on pantry_items(household_id, expiration_date)
  where is_archived = false and expiration_date is not null;
create index idx_pantry_items_low_stock on pantry_items(household_id)
  where is_archived = false and quantity <= replenishment_threshold;
create index idx_pantry_items_name_trgm on pantry_items using gin (name gin_trgm_ops);
create index idx_pantry_items_trip on pantry_items(grocery_trip_id);

-- =========================================================
-- INVENTORY MOVEMENT LOGS (append-only audit trail)
-- =========================================================
create table inventory_movement_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pantry_item_id uuid not null references pantry_items(id) on delete cascade,
  event_type movement_event_type not null,
  quantity_delta numeric(12, 3) not null,
  value_delta numeric(12, 2),
  triggered_by uuid references auth.users(id) on delete set null,
  related_recipe_id uuid references recipes(id) on delete set null,
  note text,
  occurred_at timestamptz not null default now()
);

create index idx_movement_logs_household_time on inventory_movement_logs(household_id, occurred_at desc);
create index idx_movement_logs_item on inventory_movement_logs(pantry_item_id, occurred_at desc);
create index idx_movement_logs_event_type on inventory_movement_logs(household_id, event_type);

-- =========================================================
-- RECIPE INGREDIENTS
-- =========================================================
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  raw_line text not null,
  parsed_name text not null,
  quantity numeric(12, 3),
  unit unit_of_measure,
  matched_pantry_item_id uuid references pantry_items(id) on delete set null,
  availability_status ingredient_availability_status,
  missing_quantity numeric(12, 3),
  sort_order smallint not null default 0
);

create index idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index idx_recipe_ingredients_matched_item on recipe_ingredients(matched_pantry_item_id);

-- =========================================================
-- GROCERY LIST ENTRIES
-- =========================================================
create table grocery_list_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  quantity numeric(12, 3),
  unit unit_of_measure,
  source_recipe_ingredient_id uuid references recipe_ingredients(id) on delete set null,
  is_checked boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_grocery_list_household on grocery_list_entries(household_id, is_checked);

-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_households_updated_at
  before update on households
  for each row execute function set_updated_at();

create trigger trg_pantry_items_updated_at
  before update on pantry_items
  for each row execute function set_updated_at();
```

- [ ] **Step 2: Create `supabase/migrations/20260913000002_rls_policies.sql`**

```sql
-- =========================================================
-- HELPER FUNCTIONS
-- =========================================================
create or replace function is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

create or replace function is_household_admin_or_owner(target_household_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('OWNER', 'ADMIN')
  );
$$;

-- =========================================================
-- ENABLE RLS
-- =========================================================
alter table households enable row level security;
alter table household_members enable row level security;
alter table item_categories enable row level security;
alter table pantry_items enable row level security;
alter table inventory_movement_logs enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table grocery_trips enable row level security;
alter table grocery_list_entries enable row level security;

-- =========================================================
-- HOUSEHOLDS
-- =========================================================
create policy "members can read their household"
  on households for select
  using (is_household_member(id));

create policy "any authenticated user can create a household"
  on households for insert
  with check (created_by = auth.uid());

create policy "owners/admins can update household"
  on households for update
  using (is_household_admin_or_owner(id));

create policy "only owner can delete household"
  on households for delete
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = id and hm.user_id = auth.uid() and hm.role = 'OWNER'
    )
  );

-- =========================================================
-- HOUSEHOLD MEMBERS
-- =========================================================
create policy "members can view membership roster"
  on household_members for select
  using (is_household_member(household_id));

create policy "owners/admins can add members"
  on household_members for insert
  with check (is_household_admin_or_owner(household_id));

create policy "owners/admins can update member roles"
  on household_members for update
  using (is_household_admin_or_owner(household_id));

create policy "owners/admins can remove members"
  on household_members for delete
  using (is_household_admin_or_owner(household_id));

-- =========================================================
-- ITEM CATEGORIES
-- =========================================================
create policy "members can read categories"
  on item_categories for select
  using (is_household_member(household_id));

create policy "members can create categories"
  on item_categories for insert
  with check (is_household_member(household_id));

create policy "members can update categories"
  on item_categories for update
  using (is_household_member(household_id));

create policy "admins/owners can delete categories"
  on item_categories for delete
  using (is_household_admin_or_owner(household_id));

-- =========================================================
-- PANTRY ITEMS
-- =========================================================
create policy "members can read pantry items"
  on pantry_items for select
  using (is_household_member(household_id));

create policy "members can insert pantry items"
  on pantry_items for insert
  with check (is_household_member(household_id));

create policy "members can update pantry items"
  on pantry_items for update
  using (is_household_member(household_id));

create policy "members can delete pantry items"
  on pantry_items for delete
  using (is_household_member(household_id));

-- =========================================================
-- INVENTORY MOVEMENT LOGS (append-only: no update/delete policies)
-- =========================================================
create policy "members can read movement logs"
  on inventory_movement_logs for select
  using (is_household_member(household_id));

create policy "members can insert movement logs"
  on inventory_movement_logs for insert
  with check (is_household_member(household_id));

-- =========================================================
-- RECIPES
-- =========================================================
create policy "members can read recipes"
  on recipes for select
  using (is_household_member(household_id));

create policy "members can insert recipes"
  on recipes for insert
  with check (is_household_member(household_id));

create policy "members can delete their household's recipes"
  on recipes for delete
  using (is_household_member(household_id));

-- =========================================================
-- RECIPE INGREDIENTS (scoped via parent recipe's household)
-- =========================================================
create policy "members can read recipe ingredients"
  on recipe_ingredients for select
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and is_household_member(r.household_id)
    )
  );

create policy "members can insert recipe ingredients"
  on recipe_ingredients for insert
  with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and is_household_member(r.household_id)
    )
  );

create policy "members can update recipe ingredients"
  on recipe_ingredients for update
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and is_household_member(r.household_id)
    )
  );

-- =========================================================
-- GROCERY TRIPS
-- =========================================================
create policy "members can read grocery trips"
  on grocery_trips for select
  using (is_household_member(household_id));

create policy "members can insert grocery trips"
  on grocery_trips for insert
  with check (is_household_member(household_id));

create policy "members can update grocery trips"
  on grocery_trips for update
  using (is_household_member(household_id));

-- =========================================================
-- GROCERY LIST ENTRIES
-- =========================================================
create policy "members can read grocery list"
  on grocery_list_entries for select
  using (is_household_member(household_id));

create policy "members can insert grocery list entries"
  on grocery_list_entries for insert
  with check (is_household_member(household_id));

create policy "members can update grocery list entries"
  on grocery_list_entries for update
  using (is_household_member(household_id));

create policy "members can delete grocery list entries"
  on grocery_list_entries for delete
  using (is_household_member(household_id));
```

- [ ] **Step 3: Create `supabase/migrations/20260913000003_financial_view.sql`**

```sql
create view v_household_financials as
select
  household_id,
  sum(value_delta) filter (where event_type = 'CONSUMED') as consumed_value,
  sum(value_delta) filter (where event_type in ('EXPIRED', 'SPOILED_DISCARDED')) as wasted_value
from inventory_movement_logs
group by household_id;
```

- [ ] **Step 4: Verify the migrations**

If the Supabase CLI is installed (`supabase --version` succeeds), run:
```bash
supabase init          # only if supabase/config.toml does not already exist
supabase start          # requires Docker; spins up a local Postgres
supabase db reset        # applies all three migrations in order against the local stack
```
Expected: all three files apply with no SQL errors, and `supabase db reset` reports success.

If the Supabase CLI or Docker is not available in this environment, skip live application and instead diff each file's content byte-for-byte against spec.md §2.2/§2.3/§5.1/§3.3 as a manual correctness check — table/policy/view creation order matters here specifically because `pantry_items` now references `grocery_trips` and `recipes` must exist before `inventory_movement_logs`'s `related_recipe_id` foreign key, both handled by the creation order above (unlike spec.md's presentation order, which was topic-grouped rather than dependency-ordered).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add initial schema, RLS policies, and financial view migrations"
```

---

### Task 10: `@pantry/supabase-client` — typed client factory

**Files:**
- Create: `packages/supabase-client/package.json`
- Create: `packages/supabase-client/tsconfig.json`
- Create: `packages/supabase-client/jest.config.js`
- Create: `packages/supabase-client/src/types.ts`
- Create: `packages/supabase-client/src/client.ts`
- Test: `packages/supabase-client/src/client.test.ts`

**Interfaces:**
- Consumes: the table shapes defined in Task 9's migrations (hand-typed here as a minimal `Database` interface subset; full generation via `supabase gen types typescript --local > packages/supabase-client/src/types.ts` is deferred to when a live Supabase project exists, and will replace this hand-written file wholesale).
- Produces: `createSupabaseClient(url: string, anonKey: string): SupabaseClient<Database>` — this is what `apps/mobile` and `apps/web` both call once, at app startup, to get their singleton client.

- [ ] **Step 1: Create `packages/supabase-client/package.json`**

```json
{
  "name": "@pantry/supabase-client",
  "version": "0.1.0",
  "private": true,
  "main": "src/client.ts",
  "types": "src/client.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/supabase-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/supabase-client/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};
```

- [ ] **Step 4: Create `packages/supabase-client/src/types.ts`**

```typescript
// Hand-written minimal subset matching supabase/migrations/20260913000001_initial_schema.sql.
// Replace this file with `supabase gen types typescript --local` output once a live
// Supabase project/local stack exists — do not hand-maintain this long-term.
export interface Database {
  public: {
    Tables: {
      pantry_items: {
        Row: {
          id: string;
          household_id: string;
          category_id: string | null;
          grocery_trip_id: string | null;
          name: string;
          quantity: number;
          unit: string;
          storage_location: string;
          purchase_date: string | null;
          expiration_date: string | null;
          purchase_price: number | null;
          replenishment_threshold: number | null;
          notify_on_low_stock: boolean;
          notify_days_before_expiry: number | null;
          is_archived: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['pantry_items']['Row']> & {
          household_id: string;
          name: string;
          unit: string;
        };
        Update: Partial<Database['public']['Tables']['pantry_items']['Row']>;
      };
      inventory_movement_logs: {
        Row: {
          id: string;
          household_id: string;
          pantry_item_id: string;
          event_type: 'PURCHASED' | 'CONSUMED' | 'EXPIRED' | 'SPOILED_DISCARDED' | 'MANUAL_ADJUST';
          quantity_delta: number;
          value_delta: number | null;
          triggered_by: string | null;
          related_recipe_id: string | null;
          note: string | null;
          occurred_at: string;
        };
        Insert: Partial<Database['public']['Tables']['inventory_movement_logs']['Row']> & {
          household_id: string;
          pantry_item_id: string;
          event_type: 'PURCHASED' | 'CONSUMED' | 'EXPIRED' | 'SPOILED_DISCARDED' | 'MANUAL_ADJUST';
          quantity_delta: number;
        };
        Update: Partial<Database['public']['Tables']['inventory_movement_logs']['Row']>;
      };
    };
  };
}
```

- [ ] **Step 5: Write the failing test**

```typescript
// packages/supabase-client/src/client.test.ts
import { createSupabaseClient } from './client';

describe('createSupabaseClient', () => {
  it('throws when url is missing', () => {
    expect(() => createSupabaseClient('', 'anon-key')).toThrow(
      'Supabase URL and anon key are required'
    );
  });

  it('throws when anonKey is missing', () => {
    expect(() => createSupabaseClient('https://example.supabase.co', '')).toThrow(
      'Supabase URL and anon key are required'
    );
  });

  it('returns a client instance with a queryable .from() when given valid values', () => {
    const client = createSupabaseClient('https://example.supabase.co', 'fake-anon-key');
    expect(typeof client.from).toBe('function');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/supabase-client && npx jest client`
Expected: FAIL with `Cannot find module './client'`.

- [ ] **Step 7: Write the implementation**

```typescript
// packages/supabase-client/src/client.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient<Database> {
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export type { Database };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/supabase-client && npx jest client`
Expected: PASS, 3 assertions green. (`createClient` builds a client object without making a network call, so a fake URL/key is safe here.)

- [ ] **Step 9: Commit**

```bash
git add packages/supabase-client
git commit -m "feat(supabase-client): add typed Supabase client factory"
```

---

### Task 11: `apps/mobile` — Expo app wired to shared packages

**Files:**
- Create: `apps/mobile/` (generated by `create-expo-app`, then modified)
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/App.tsx`
- Create: `apps/mobile/src/screens/DashboardScreen.tsx`
- Create: `apps/mobile/src/screens/PantryScreen.tsx`
- Create: `apps/mobile/src/screens/RecipeOcrScreen.tsx`
- Create: `apps/mobile/src/screens/ShoppingListScreen.tsx`
- Create: `apps/mobile/src/screens/FinancialsScreen.tsx`
- Create: `apps/mobile/src/navigation/BottomTabs.tsx`

**Interfaces:**
- Consumes: `formatPHP` from `@pantry/core` (Task 5), `ocrProvider` from `@pantry/ocr` (Task 6, resolved to `ocr.native.ts`), `notificationProvider` from `@pantry/notifications` (Task 7, resolved to `notifications.native.ts`), `createSupabaseClient` from `@pantry/supabase-client` (Task 10).
- Produces: a running bottom-tab-navigated app matching the 5 tabs from spec §4.2 (Home, Pantry, Recipe, Shop, Financial), each currently a placeholder screen — feature implementation plans fill these in.

- [ ] **Step 1: Generate the Expo app**

Run from the repo root:
```bash
npx create-expo-app@latest apps/mobile --template blank-typescript
```
Expected: `apps/mobile/` is created with `App.tsx`, `package.json`, `app.json`, `tsconfig.json`.

- [ ] **Step 2: Rename the package and link workspace dependencies**

Edit `apps/mobile/package.json`: change `"name"` to `"@pantry/mobile"`, and add to `"dependencies"`:
```json
"@pantry/core": "*",
"@pantry/ocr": "*",
"@pantry/notifications": "*",
"@pantry/ui": "*",
"@pantry/supabase-client": "*",
"@react-navigation/native": "^6.1.18",
"@react-navigation/bottom-tabs": "^6.6.1",
"react-native-safe-area-context": "4.10.5",
"react-native-screens": "3.31.1"
```

- [ ] **Step 3: Create the bottom tab navigator**

```typescript
// apps/mobile/src/navigation/BottomTabs.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DashboardScreen } from '../screens/DashboardScreen';
import { PantryScreen } from '../screens/PantryScreen';
import { RecipeOcrScreen } from '../screens/RecipeOcrScreen';
import { ShoppingListScreen } from '../screens/ShoppingListScreen';
import { FinancialsScreen } from '../screens/FinancialsScreen';

const Tab = createBottomTabNavigator();

export function BottomTabs() {
  return (
    <NavigationContainer>
      <Tab.Navigator>
        <Tab.Screen name="Home" component={DashboardScreen} />
        <Tab.Screen name="Pantry" component={PantryScreen} />
        <Tab.Screen name="Recipe" component={RecipeOcrScreen} />
        <Tab.Screen name="Shop" component={ShoppingListScreen} />
        <Tab.Screen name="Financial" component={FinancialsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
```

- [ ] **Step 4: Create placeholder screens (each proves its package import resolves)**

```tsx
// apps/mobile/src/screens/DashboardScreen.tsx
import { View, Text } from 'react-native';

export function DashboardScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Dashboard</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/PantryScreen.tsx
import { View, Text } from 'react-native';

export function PantryScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Pantry Inventory</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/RecipeOcrScreen.tsx
import { View, Text } from 'react-native';

export function RecipeOcrScreen() {
  // ocrProvider from '@pantry/ocr' resolves to ocr.native.ts here via Metro's
  // platform-suffix resolution — wired up fully in the Recipe OCR feature plan.
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Recipe OCR Inspector</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/ShoppingListScreen.tsx
import { View, Text } from 'react-native';

export function ShoppingListScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Shopping List</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/FinancialsScreen.tsx
import { View, Text } from 'react-native';
import { formatPHP } from '@pantry/core';

export function FinancialsScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Financial snapshot: {formatPHP(0)}</Text>
    </View>
  );
}
```

- [ ] **Step 5: Wire `App.tsx` to the tab navigator**

```tsx
// apps/mobile/App.tsx
import { BottomTabs } from './src/navigation/BottomTabs';

export default function App() {
  return <BottomTabs />;
}
```

- [ ] **Step 6: Install and typecheck**

Run: `npm install` (from repo root, so the workspace links resolve), then `cd apps/mobile && npx tsc --noEmit`
Expected: no type errors. The `formatPHP` import from `@pantry/core` and the workspace `@pantry/*` deps must resolve — if they don't, confirm the root `npm install` picked up the new `apps/mobile` workspace member (re-run `npm install` from the repo root).

- [ ] **Step 7: Manually smoke-test the Metro bundler boots**

Run: `cd apps/mobile && npx expo start`
Expected: Metro bundler starts without a build error and prints a QR code / dev server URL. A full simulator/device boot is outside what this scaffold task can verify headlessly — confirm visually via Expo Go or a simulator when one is available.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): scaffold Expo app with bottom-tab navigation and shared package wiring"
```

---

### Task 12: `apps/web` — Next.js app with react-native-web, wired to shared packages

**Files:**
- Create: `apps/web/` (generated by `create-next-app`, then modified)
- Modify: `apps/web/package.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/pantry/page.tsx`
- Create: `apps/web/src/app/recipe/page.tsx`
- Create: `apps/web/src/app/shopping-list/page.tsx`
- Create: `apps/web/src/app/financials/page.tsx`
- Create: `apps/web/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `formatPHP` from `@pantry/core` (Task 5), `createSupabaseClient` from `@pantry/supabase-client` (Task 10); `ocrProvider`/`notificationProvider` resolve to the `.web.ts` variants once wired into interactive screens in later feature plans.
- Produces: a Next.js App Router shell with a persistent sidebar (spec §4.3) and 5 route placeholders mirroring the mobile app's 5 tabs.

- [ ] **Step 1: Generate the Next.js app**

Run from the repo root:
```bash
npx create-next-app@latest apps/web --typescript --eslint --app --no-tailwind --src-dir --import-alias "@/*" --no-turbopack
```
Expected: `apps/web/` created with `src/app/`, `package.json`, `next.config.js` (or `.ts`), `tsconfig.json`.

- [ ] **Step 2: Rename the package and add workspace + react-native-web dependencies**

Edit `apps/web/package.json`: change `"name"` to `"@pantry/web"`, and add to `"dependencies"`:
```json
"@pantry/core": "*",
"@pantry/ocr": "*",
"@pantry/notifications": "*",
"@pantry/ui": "*",
"@pantry/supabase-client": "*",
"react-native-web": "^0.19.13"
```

- [ ] **Step 3: Configure webpack to alias `react-native` to `react-native-web`**

```javascript
// apps/web/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['react-native-web'],
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'react-native$': 'react-native-web',
    };
    config.resolve.extensions = [
      '.web.js',
      '.web.jsx',
      '.web.ts',
      '.web.tsx',
      ...config.resolve.extensions,
    ];
    return config;
  },
};

module.exports = nextConfig;
```

- [ ] **Step 4: Create the sidebar shell**

```tsx
// apps/web/src/components/Sidebar.tsx
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/pantry', label: 'Pantry' },
  { href: '/recipe', label: 'Recipe' },
  { href: '/shopping-list', label: 'Shop' },
  { href: '/financials', label: 'Financial' },
];

export function Sidebar() {
  return (
    <nav style={{ width: 200, borderRight: '1px solid #ddd', padding: 16 }}>
      {NAV_ITEMS.map((item) => (
        <div key={item.href} style={{ marginBottom: 12 }}>
          <Link href={item.href}>{item.label}</Link>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Wire the root layout**

```tsx
// apps/web/src/app/layout.tsx
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';

export const metadata = {
  title: 'Pantry Tracker',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, display: 'flex' }}>
        <Sidebar />
        <main style={{ flex: 1, padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create the 5 route placeholders**

```tsx
// apps/web/src/app/page.tsx
export default function DashboardPage() {
  return <h1>Dashboard</h1>;
}
```

```tsx
// apps/web/src/app/pantry/page.tsx
export default function PantryPage() {
  return <h1>Pantry Inventory</h1>;
}
```

```tsx
// apps/web/src/app/recipe/page.tsx
export default function RecipePage() {
  return <h1>Recipe OCR Inspector</h1>;
}
```

```tsx
// apps/web/src/app/shopping-list/page.tsx
export default function ShoppingListPage() {
  return <h1>Shopping List</h1>;
}
```

```tsx
// apps/web/src/app/financials/page.tsx
import { formatPHP } from '@pantry/core';

export default function FinancialsPage() {
  return <h1>Financial snapshot: {formatPHP(0)}</h1>;
}
```

- [ ] **Step 7: Install and build**

Run: `npm install` (from repo root), then `cd apps/web && npm run build`
Expected: build completes with no errors. This exercises both the workspace `@pantry/*` resolution and the `react-native-web` webpack alias in one pass, since `formatPHP` (Task 5) must resolve through the workspace link and the layout/page tree must compile under the modified webpack config.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): scaffold Next.js app with react-native-web aliasing, sidebar nav, and shared package wiring"
```

---

### Task 13: Root-level verification pass

**Files:**
- None created — this task only runs and confirms the aggregate scripts from Task 1's root `package.json`.

**Interfaces:**
- Consumes: the `test` and `typecheck` scripts from every package created in Tasks 2–12.

- [ ] **Step 1: Run every package's test suite from the root**

Run: `npm run test --workspaces --if-present`
Expected: `@pantry/core` (4 suites), `@pantry/ocr` (1 suite), `@pantry/notifications` (1 suite), `@pantry/ui` (1 suite), `@pantry/supabase-client` (1 suite) all report PASS. `apps/mobile` and `apps/web` have no `test` script yet, so they're skipped by `--if-present` — that's expected at this stage.

- [ ] **Step 2: Run typecheck across every package**

Run: `npm run typecheck --workspaces --if-present`
Expected: no errors from any package. `apps/mobile`/`apps/web` typecheck via their own `tsc --noEmit` invocations from Tasks 11/12 Step 6 and 12 Step 7's build.

- [ ] **Step 3: Confirm git history is clean**

Run: `git status`
Expected: working tree clean (everything from Tasks 1–12 committed).

- [ ] **Step 4: Commit a scaffold-complete marker commit only if Step 1-3 surfaced fixes**

If Steps 1–2 required any fixes (e.g., a missed dependency), commit them now:
```bash
git add -A
git commit -m "fix: resolve cross-package typecheck/test issues found in scaffold verification pass"
```
If nothing needed fixing, skip this step — there is nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** §1 (architecture) → Tasks 1, 11, 12. §2 (schema) → Task 9. §3.1 (OCR pipeline) → Task 6. §3.2 (conversion/matching) → Tasks 2–3. §3.3 (financial formulas) → Task 4. §4 (UX hierarchy) → Tasks 11–12 (structural shells only; full layouts are feature-implementation work, called out explicitly in each task's Interfaces block). §5 (RLS) → Task 9 Step 2. §6.1 (offline-first) and §6.5 (notification tokens) → Task 7 lays the provider interface; the TanStack Query cache/write-queue itself is feature-implementation work, not scaffolding, and is out of scope for this plan. §6.4 (retention/view) → Task 9 Step 3.
- **Placeholder scan:** no "TBD"/"handle appropriately" language; every code block is complete and copy-pasteable. The one deliberately deferred item (full `supabase gen types` output in Task 10) is explicitly marked as a hand-written interim stand-in with a stated replacement trigger, not a placeholder.
- **Type consistency:** `OcrInput`/`OcrResult`/`IOcrProvider` (Task 6) match the exact shapes used in spec §3.1 and are not redefined differently anywhere else. `formatPHP` (Task 5) is imported with the same signature in both `apps/mobile/src/screens/FinancialsScreen.tsx` and `apps/web/src/app/financials/page.tsx`. `MovementLogRecord.eventType` (Task 4) uses the same 5 literal strings as the `movement_event_type` Postgres enum (Task 9) and the `Database['public']['Tables']['inventory_movement_logs']['Row']['event_type']` union (Task 10).
