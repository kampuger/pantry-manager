# Pantry Editing, Lifecycle & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add item editing, produce-aware expiry defaults, a consumed/expired lifecycle, a notification-preferences UI, and a location-grouped visual redesign to the Pantry screen on both `apps/web` and `apps/mobile`.

**Architecture:** Pure business logic (expiry computation, location grouping) lives in the dependency-free `packages/core` and `packages/ui` packages and is unit-tested with Jest. `packages/supabase-client` gains `updatePantryItem`, `archivePantryItem`, and household notification-prefs functions alongside the existing `addPantryItem`/`getMyHousehold`. Each app wires this into a rebuilt Pantry screen: a shared add/edit `ItemForm`, a `PantryLocationGroup` list renderer, and a `NotificationPrefsModal`. No new architecture (no state library, no nested navigators) — matches the codebase's existing pattern of small per-app screens built from small components.

**Tech Stack:** TypeScript, Next.js (web) / Expo + React Native (mobile), Supabase (Postgres + supabase-js), Jest + ts-jest for `packages/*` unit tests.

**Spec:** `docs/superpowers/specs/2026-09-14-pantry-editing-lifecycle-notifications-design.md`

## Global Constraints

- There is no local/live Supabase stack wired into this repo yet (see the comment atop `packages/supabase-client/src/types.ts`) — the migration task is verified by review against the existing schema file's conventions, not by running it.
- Neither `apps/web` nor `apps/mobile` has a component-level test runner (only `packages/*` have Jest). UI tasks are verified manually via the `run-web` / `run-mobile` skills, not with automated tests.
- Match existing duplication style: `apps/web` and `apps/mobile` each get their own copies of `ItemForm`, `PantryLocationGroup`, and `NotificationPrefsModal` (mirrors the existing `AddItemForm`/`RealPantryList` duplication) — no new shared UI package.
- `is_produce` defaults to `true` on every new item. Produce expiry = `purchase_date + 7 days` (not user-editable); non-produce requires a manually entered date.
- Household notification defaults: produce = 2 days before expiry, non-produce = 7 days before expiry (`households.notify_days_produce` / `notify_days_nonproduce`, both editable via the new Notification Preferences UI). A per-item override lives in `pantry_items.notify_days_before_expiry` (`null` = inherit the household default).
- Consumed/expired items are soft-archived (`is_archived = true`) plus one `inventory_movement_logs` row (`CONSUMED` or `SPOILED_DISCARDED`) — never hard-deleted.
- Notification **delivery** (push/browser) is explicitly out of scope this plan — only preferences are configured.

---

## Phase 1 — Shared business logic

### Task 1: Database migration — produce flag & notification defaults

**Files:**
- Create: `supabase/migrations/20260914000001_pantry_produce_lifecycle_notifications.sql`

**Interfaces:**
- Produces: columns `pantry_items.is_produce` (boolean, default true), `households.notify_days_produce` (smallint, default 2), `households.notify_days_nonproduce` (smallint, default 7); `pantry_items.notify_days_before_expiry` keeps its existing nullable type but loses its `default 3`.

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================
-- PANTRY ITEMS: produce flag
-- =========================================================
alter table pantry_items
  add column is_produce boolean not null default true;

comment on column pantry_items.is_produce is
  'True for perishable produce (auto-expiry = purchase_date + 7 days); false requires a manually entered expiration_date.';

-- notify_days_before_expiry was already nullable; null now means "inherit
-- the household's produce/non-produce default" instead of a fixed 3.
alter table pantry_items
  alter column notify_days_before_expiry drop default;

-- =========================================================
-- HOUSEHOLDS: notification defaults
-- =========================================================
alter table households
  add column notify_days_produce smallint not null default 2,
  add column notify_days_nonproduce smallint not null default 7;

comment on column households.notify_days_produce is
  'Default reminder lead time (days before expiry) for produce items with no per-item override.';
comment on column households.notify_days_nonproduce is
  'Default reminder lead time (days before expiry) for non-produce items with no per-item override.';
```

- [ ] **Step 2: Review against existing schema conventions**

Compare against `supabase/migrations/20260913000001_initial_schema.sql` and `20260913000002_rls_policies.sql`: naming (`snake_case`), comment style (`comment on column ...`), and confirm no RLS changes are needed — the existing `"owners/admins can update household"` policy (`supabase/migrations/20260913000002_rls_policies.sql:59-61`) already covers writes to the two new `households` columns, and `"members can update pantry items"` (same file, lines 132-134) already covers `is_produce`. No new policies required.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260914000001_pantry_produce_lifecycle_notifications.sql
git commit -m "feat(db): add produce flag and notification defaults to pantry schema"
```

---

### Task 2: `packages/core` — expiry computation

**Files:**
- Create: `packages/core/src/expiry.ts`
- Create: `packages/core/src/expiry.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `computeExpiryDate(input: { isProduce: boolean; purchaseDate?: string; manualDate?: string | null }): string`, consumed by both apps' `ItemForm` (Tasks 8, 10). (A `resolveNotifyDaysBeforeExpiry` helper was considered but dropped — nothing in this plan needs to compute the *effective* notify-days value: forms just pass the raw per-item override or `null` straight through to `pantry_items.notify_days_before_expiry`, and the only consumer that would need to resolve "override vs. household default" is the notification-delivery job, which is out of scope. Add it back when that job is built.)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/expiry.test.ts
import { computeExpiryDate } from './expiry';

describe('computeExpiryDate', () => {
  it('computes produce expiry as 7 days after the purchase date', () => {
    expect(computeExpiryDate({ isProduce: true, purchaseDate: '2026-09-14' })).toBe('2026-09-21');
  });

  it('defaults the purchase date to today when producing and none is given', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00Z'));
    try {
      expect(computeExpiryDate({ isProduce: true })).toBe('2026-09-21');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the manual date for non-produce items', () => {
    expect(computeExpiryDate({ isProduce: false, manualDate: '2027-01-01' })).toBe('2027-01-01');
  });

  it('throws when non-produce and no manual date is given', () => {
    expect(() => computeExpiryDate({ isProduce: false })).toThrow(
      'manualDate is required for non-produce items'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@pantry/core`
Expected: FAIL — `Cannot find module './expiry'`

- [ ] **Step 3: Implement**

```ts
// packages/core/src/expiry.ts
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

```

- [ ] **Step 4: Export from the package index**

```ts
// packages/core/src/index.ts
export * from './unitConversion';
export * from './ingredientParser';
export * from './financial';
export * from './currency';
export * from './freshness';
export * from './recipeMatcher';
export * from './expiry';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=@pantry/core`
Expected: PASS (all suites, including the pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/expiry.ts packages/core/src/expiry.test.ts packages/core/src/index.ts
git commit -m "feat(core): add produce-aware expiry date and notify-days computation"
```

---

### Task 3: `packages/ui` — location grouping

**Files:**
- Create: `packages/ui/src/pantryGrouping.ts`
- Create: `packages/ui/src/pantryGrouping.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `getExpiryBadgeStatus` from `./expiryStatus` (same package).
- Produces: `groupItemsByLocation(items: GroupableItem[], locationOrder: readonly string[]): LocationGroup[]`, consumed by both apps' Pantry screens.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ui/src/pantryGrouping.test.ts
import { groupItemsByLocation } from './pantryGrouping';

describe('groupItemsByLocation', () => {
  it('groups items by location in the given order, omitting empty locations', () => {
    const items = [
      { id: '1', storageLocation: 'PANTRY', daysUntilExpiry: 30 },
      { id: '2', storageLocation: 'FRIDGE', daysUntilExpiry: 1 },
      { id: '3', storageLocation: 'FRIDGE', daysUntilExpiry: 10 },
    ];
    const result = groupItemsByLocation(items, ['FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER', 'OTHER']);
    expect(result).toEqual([
      { location: 'FRIDGE', itemIds: ['2', '3'], expiringSoonCount: 1 },
      { location: 'PANTRY', itemIds: ['1'], expiringSoonCount: 0 },
    ]);
  });

  it('returns an empty array when there are no items', () => {
    expect(groupItemsByLocation([], ['FRIDGE', 'PANTRY'])).toEqual([]);
  });

  it('counts items with unknown expiry as not expiring soon', () => {
    const items = [{ id: '1', storageLocation: 'PANTRY', daysUntilExpiry: null }];
    expect(groupItemsByLocation(items, ['PANTRY'])).toEqual([
      { location: 'PANTRY', itemIds: ['1'], expiringSoonCount: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@pantry/ui`
Expected: FAIL — `Cannot find module './pantryGrouping'`

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/pantryGrouping.ts
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
```

- [ ] **Step 4: Export from the package index**

```ts
// packages/ui/src/index.ts
export * from './expiryStatus';
export * from './pantryGrouping';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=@pantry/ui`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/pantryGrouping.ts packages/ui/src/pantryGrouping.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add location-grouping helper for the pantry screen"
```

---

## Phase 2 — `packages/supabase-client`

### Task 4: Extend `addPantryItem` with produce flag, notify override, and purchase date

**Files:**
- Modify: `packages/supabase-client/src/types.ts:39-67` (pantry_items table)
- Modify: `packages/supabase-client/src/pantry.ts` (whole file)
- Modify: `packages/supabase-client/src/pantry.test.ts` (whole file, and later tasks continue extending it)

**Interfaces:**
- Consumes: nothing new.
- Produces: `NewPantryItemInput` now requires `isProduce: boolean` and accepts `notifyDaysBeforeExpiry?: number | null`; `addPantryItem` stamps `purchase_date` to today server-side. This `PantryItemRow` type (with `is_produce`) is what Task 5, 6, and both apps' screens consume.

- [ ] **Step 1: Update the `pantry_items` table type**

In `packages/supabase-client/src/types.ts`, add `is_produce: boolean;` to the `Row` type, right after `storage_location: string;`:

```ts
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
          is_produce: boolean;
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
        Relationships: [];
      };
```

- [ ] **Step 2: Write the failing tests**

Replace the full contents of `packages/supabase-client/src/pantry.test.ts` with:

```ts
import { addPantryItem, updatePantryItem, archivePantryItem } from './pantry';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakePantryClient(config: {
  insert?: (payload: any) => Promise<{ data: any; error: any }>;
  update?: (payload: any, id: string) => Promise<{ data: any; error: any }>;
  updateNoSelect?: (payload: any, id: string) => Promise<{ error: any }>;
  logInsert?: (payload: any) => Promise<{ error: any }>;
}): SupabaseClient<Database> & { lastPayload: any; lastLogPayload: any } {
  const client: any = { lastPayload: undefined, lastLogPayload: undefined };
  client.from = (table: string): any => {
    if (table === 'pantry_items') {
      return {
        insert: (payload: any) => {
          client.lastPayload = payload;
          return { select: () => ({ single: async () => config.insert!(payload) }) };
        },
        update: (payload: any) => {
          client.lastPayload = payload;
          return {
            eq: (_col: string, id: string) => {
              if (config.updateNoSelect) {
                const resultPromise = config.updateNoSelect(payload, id);
                return { then: (resolve: any) => resultPromise.then(resolve) };
              }
              return { select: () => ({ single: async () => config.update!(payload, id) }) };
            },
          };
        },
      };
    }
    if (table === 'inventory_movement_logs') {
      return {
        insert: (payload: any) => {
          client.lastLogPayload = payload;
          const resultPromise = config.logInsert!(payload);
          return { then: (resolve: any) => resultPromise.then(resolve) };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
  return client;
}

describe('addPantryItem', () => {
  it('inserts a pantry item scoped to the household and returns the created row', async () => {
    const row = {
      id: 'item-1',
      household_id: 'house-1',
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storage_location: 'FRIDGE',
      is_produce: true,
      expiration_date: '2026-09-20',
    };
    const client = fakePantryClient({ insert: async () => ({ data: row, error: null }) });

    const result = await addPantryItem(client, 'house-1', 'user-1', {
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storageLocation: 'FRIDGE',
      isProduce: true,
      expirationDate: '2026-09-20',
    });

    expect(result).toEqual(row);
    expect(client.lastPayload).toMatchObject({
      household_id: 'house-1',
      created_by: 'user-1',
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storage_location: 'FRIDGE',
      is_produce: true,
      expiration_date: '2026-09-20',
      notify_days_before_expiry: null,
    });
    expect(client.lastPayload.purchase_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults expiration_date and notify override to null when not provided', async () => {
    const client = fakePantryClient({ insert: async () => ({ data: { id: 'item-2' }, error: null }) });

    await addPantryItem(client, 'house-1', 'user-1', {
      name: 'Rice',
      quantity: 2,
      unit: 'kg',
      storageLocation: 'PANTRY',
      isProduce: false,
    });

    expect(client.lastPayload.expiration_date).toBeNull();
    expect(client.lastPayload.notify_days_before_expiry).toBeNull();
  });

  it('throws when the insert errors', async () => {
    const client = fakePantryClient({ insert: async () => ({ data: null, error: new Error('insert failed') }) });

    await expect(
      addPantryItem(client, 'house-1', 'user-1', {
        name: 'Rice',
        quantity: 2,
        unit: 'kg',
        storageLocation: 'PANTRY',
        isProduce: false,
      })
    ).rejects.toThrow('insert failed');
  });
});
```

(`updatePantryItem` and `archivePantryItem` tests are added in Tasks 5 and 6 — leave them out of this step; the file above is the complete, correct state for this task alone.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: FAIL — `addPantryItem` doesn't accept `isProduce`/stamp `purchase_date` yet (TS type error / assertion failures)

- [ ] **Step 4: Implement**

Replace the full contents of `packages/supabase-client/src/pantry.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

export interface NewPantryItemInput {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate?: string | null;
  notifyDaysBeforeExpiry?: number | null;
}

export async function addPantryItem(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  input: NewPantryItemInput
): Promise<PantryItemRow> {
  const { data, error } = await client
    .from('pantry_items')
    .insert({
      household_id: householdId,
      created_by: userId,
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      storage_location: input.storageLocation,
      is_produce: input.isProduce,
      purchase_date: new Date().toISOString().slice(0, 10),
      expiration_date: input.expirationDate ?? null,
      notify_days_before_expiry: input.notifyDaysBeforeExpiry ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/supabase-client/src/types.ts packages/supabase-client/src/pantry.ts packages/supabase-client/src/pantry.test.ts
git commit -m "feat(supabase-client): add produce flag and notify override to addPantryItem"
```

---

### Task 5: Add `updatePantryItem`

**Files:**
- Modify: `packages/supabase-client/src/pantry.ts` (append)
- Modify: `packages/supabase-client/src/pantry.test.ts` (append)

**Interfaces:**
- Consumes: `PantryItemRow` from Task 4.
- Produces: `updatePantryItem(client, itemId: string, input: UpdatePantryItemInput): Promise<PantryItemRow>`, consumed by both apps' edit flow (Task 8, 10).

- [ ] **Step 1: Write the failing tests**

Append to `packages/supabase-client/src/pantry.test.ts`:

```ts
describe('updatePantryItem', () => {
  it('sends only the provided fields and returns the updated row', async () => {
    const row = { id: 'item-1', name: 'Whole Milk', is_produce: false };
    const client = fakePantryClient({ update: async () => ({ data: row, error: null }) });

    const result = await updatePantryItem(client, 'item-1', { name: 'Whole Milk', isProduce: false });

    expect(result).toEqual(row);
    expect(client.lastPayload).toEqual({ name: 'Whole Milk', is_produce: false });
  });

  it('throws when the update errors', async () => {
    const client = fakePantryClient({ update: async () => ({ data: null, error: new Error('update failed') }) });

    await expect(updatePantryItem(client, 'item-1', { name: 'x' })).rejects.toThrow('update failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: FAIL — `updatePantryItem` is not exported

- [ ] **Step 3: Implement**

Append to `packages/supabase-client/src/pantry.ts`:

```ts
export interface UpdatePantryItemInput {
  name?: string;
  quantity?: number;
  unit?: string;
  storageLocation?: string;
  isProduce?: boolean;
  expirationDate?: string | null;
  notifyDaysBeforeExpiry?: number | null;
}

export async function updatePantryItem(
  client: SupabaseClient<Database>,
  itemId: string,
  input: UpdatePantryItemInput
): Promise<PantryItemRow> {
  const changes: Database['public']['Tables']['pantry_items']['Update'] = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.quantity !== undefined) changes.quantity = input.quantity;
  if (input.unit !== undefined) changes.unit = input.unit;
  if (input.storageLocation !== undefined) changes.storage_location = input.storageLocation;
  if (input.isProduce !== undefined) changes.is_produce = input.isProduce;
  if (input.expirationDate !== undefined) changes.expiration_date = input.expirationDate;
  if (input.notifyDaysBeforeExpiry !== undefined) {
    changes.notify_days_before_expiry = input.notifyDaysBeforeExpiry;
  }

  const { data, error } = await client
    .from('pantry_items')
    .update(changes)
    .eq('id', itemId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/supabase-client/src/pantry.ts packages/supabase-client/src/pantry.test.ts
git commit -m "feat(supabase-client): add updatePantryItem"
```

---

### Task 6: Add `archivePantryItem` (consumed/expired lifecycle)

**Files:**
- Modify: `packages/supabase-client/src/pantry.ts` (append)
- Modify: `packages/supabase-client/src/pantry.test.ts` (append)

**Interfaces:**
- Produces: `archivePantryItem(client, input: { itemId, householdId, quantity, eventType: 'CONSUMED' | 'SPOILED_DISCARDED', userId }): Promise<void>`, consumed by both apps' Consumed/Expired buttons (Task 8, 10).

- [ ] **Step 1: Write the failing tests**

Append to `packages/supabase-client/src/pantry.test.ts`:

```ts
describe('archivePantryItem', () => {
  it('archives the item and logs the movement event', async () => {
    const client = fakePantryClient({
      updateNoSelect: async () => ({ error: null }),
      logInsert: async () => ({ error: null }),
    });

    await archivePantryItem(client, {
      itemId: 'item-1',
      householdId: 'house-1',
      quantity: 2,
      eventType: 'CONSUMED',
      userId: 'user-1',
    });

    expect(client.lastPayload).toEqual({ is_archived: true });
    expect(client.lastLogPayload).toEqual({
      household_id: 'house-1',
      pantry_item_id: 'item-1',
      event_type: 'CONSUMED',
      quantity_delta: -2,
      triggered_by: 'user-1',
    });
  });

  it('throws and skips the log when the archive update errors', async () => {
    const client = fakePantryClient({
      updateNoSelect: async () => ({ error: new Error('archive failed') }),
      logInsert: async () => ({ error: null }),
    });

    await expect(
      archivePantryItem(client, {
        itemId: 'item-1',
        householdId: 'house-1',
        quantity: 1,
        eventType: 'SPOILED_DISCARDED',
        userId: 'user-1',
      })
    ).rejects.toThrow('archive failed');
  });

  it('throws when the movement log insert errors', async () => {
    const client = fakePantryClient({
      updateNoSelect: async () => ({ error: null }),
      logInsert: async () => ({ error: new Error('log failed') }),
    });

    await expect(
      archivePantryItem(client, {
        itemId: 'item-1',
        householdId: 'house-1',
        quantity: 1,
        eventType: 'CONSUMED',
        userId: 'user-1',
      })
    ).rejects.toThrow('log failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: FAIL — `archivePantryItem` is not exported

- [ ] **Step 3: Implement**

Append to `packages/supabase-client/src/pantry.ts`:

```ts
export type ArchiveEventType = 'CONSUMED' | 'SPOILED_DISCARDED';

export interface ArchivePantryItemInput {
  itemId: string;
  householdId: string;
  quantity: number;
  eventType: ArchiveEventType;
  userId: string;
}

export async function archivePantryItem(
  client: SupabaseClient<Database>,
  input: ArchivePantryItemInput
): Promise<void> {
  const { error: updateError } = await client
    .from('pantry_items')
    .update({ is_archived: true })
    .eq('id', input.itemId);

  if (updateError) throw updateError;

  const { error: logError } = await client.from('inventory_movement_logs').insert({
    household_id: input.householdId,
    pantry_item_id: input.itemId,
    event_type: input.eventType,
    quantity_delta: -Math.abs(input.quantity),
    triggered_by: input.userId,
  });

  if (logError) throw logError;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/supabase-client/src/pantry.ts packages/supabase-client/src/pantry.test.ts
git commit -m "feat(supabase-client): add archivePantryItem for consumed/expired lifecycle"
```

---

### Task 7: Household notification preferences

**Files:**
- Modify: `packages/supabase-client/src/types.ts:7-22` (households table)
- Modify: `packages/supabase-client/src/household.ts` (append)
- Modify: `packages/supabase-client/src/household.test.ts` (append)

**Interfaces:**
- Produces: `getHouseholdNotificationPrefs(client, householdId): Promise<NotificationPreferences>` and `updateHouseholdNotificationPrefs(client, householdId, prefs): Promise<void>`, consumed by both apps' `NotificationPrefsModal` (Task 9, 11).

- [ ] **Step 1: Update the `households` table type**

In `packages/supabase-client/src/types.ts`, update the `households.Row` type:

```ts
      households: {
        Row: {
          id: string;
          name: string;
          weekly_shopping_day: number | null;
          notify_days_produce: number;
          notify_days_nonproduce: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['households']['Row']> & {
          name: string;
          created_by: string;
        };
        Update: Partial<Database['public']['Tables']['households']['Row']>;
        Relationships: [];
      };
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/supabase-client/src/household.test.ts` (update the top import line to also pull in the two new functions: `import { getMyHousehold, createHousehold, getHouseholdNotificationPrefs, updateHouseholdNotificationPrefs } from './household';`):

```ts
describe('getHouseholdNotificationPrefs', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return { select: () => ({ eq: () => ({ single: async () => result }) }) };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('returns the household notification defaults', async () => {
    const client = fakeClient({ data: { notify_days_produce: 2, notify_days_nonproduce: 7 }, error: null });
    expect(await getHouseholdNotificationPrefs(client, 'house-1')).toEqual({
      notifyDaysProduce: 2,
      notifyDaysNonproduce: 7,
    });
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getHouseholdNotificationPrefs(client, 'house-1')).rejects.toThrow('boom');
  });
});

describe('updateHouseholdNotificationPrefs', () => {
  function fakeClient(error: any, capture: { payload?: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return { eq: () => ({ then: (resolve: any) => Promise.resolve({ error }).then(resolve) }) };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes both preference fields', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient(null, capture);
    await updateHouseholdNotificationPrefs(client, 'house-1', { notifyDaysProduce: 3, notifyDaysNonproduce: 10 });
    expect(capture.payload).toEqual({ notify_days_produce: 3, notify_days_nonproduce: 10 });
  });

  it('throws when the update errors', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient(new Error('update failed'), capture);
    await expect(
      updateHouseholdNotificationPrefs(client, 'house-1', { notifyDaysProduce: 3, notifyDaysNonproduce: 10 })
    ).rejects.toThrow('update failed');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: FAIL — the two new functions are not exported

- [ ] **Step 4: Implement**

Append to `packages/supabase-client/src/household.ts`:

```ts
export interface NotificationPreferences {
  notifyDaysProduce: number;
  notifyDaysNonproduce: number;
}

export async function getHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from('households')
    .select('notify_days_produce, notify_days_nonproduce')
    .eq('id', householdId)
    .single();

  if (error) throw error;
  return {
    notifyDaysProduce: data.notify_days_produce,
    notifyDaysNonproduce: data.notify_days_nonproduce,
  };
}

export async function updateHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string,
  prefs: NotificationPreferences
): Promise<void> {
  const { error } = await client
    .from('households')
    .update({
      notify_days_produce: prefs.notifyDaysProduce,
      notify_days_nonproduce: prefs.notifyDaysNonproduce,
    })
    .eq('id', householdId);

  if (error) throw error;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=@pantry/supabase-client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/supabase-client/src/types.ts packages/supabase-client/src/household.ts packages/supabase-client/src/household.test.ts
git commit -m "feat(supabase-client): add household notification preferences read/write"
```

---

## Phase 3 — Web (`apps/web`)

### Task 8: Web — interactive Pantry screen (edit, lifecycle actions, location grouping)

**Files:**
- Create: `apps/web/src/components/pantry/ItemForm.tsx`
- Create: `apps/web/src/components/pantry/PantryLocationGroup.tsx`
- Modify: `apps/web/src/app/pantry/page.tsx` (whole file)

**Interfaces:**
- Consumes: `computeExpiryDate` (`@pantry/core`), `groupItemsByLocation`/`getExpiryBadgeStatus` (`@pantry/ui`), `addPantryItem`/`updatePantryItem`/`archivePantryItem`/`STORAGE_LOCATION_OPTIONS`/`UNIT_OPTIONS` (`@pantry/supabase-client`).
- Produces: `ItemForm` (exported `ItemFormValues`, `ItemFormInitialValues`) and `PantryLocationGroup`, both reused only within `apps/web`.

- [ ] **Step 1: Create the shared add/edit form**

```tsx
// apps/web/src/components/pantry/ItemForm.tsx
'use client';

import { useState } from 'react';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate } from '@pantry/core';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export interface ItemFormValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
}

export interface ItemFormInitialValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
  /** The item's existing purchase date; null on add (defaults to today). */
  purchaseDate: string | null;
}

const EMPTY_VALUES: ItemFormInitialValues = {
  name: '',
  quantity: 1,
  unit: UNIT_OPTIONS[0],
  storageLocation: STORAGE_LOCATION_OPTIONS[0],
  isProduce: true,
  expirationDate: null,
  notifyDaysOverride: null,
  purchaseDate: null,
};

export function ItemForm({
  initialValues = EMPTY_VALUES,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialValues?: ItemFormInitialValues;
  submitLabel: string;
  onSubmit: (values: ItemFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(String(initialValues.quantity));
  const [unit, setUnit] = useState(initialValues.unit);
  const [storageLocation, setStorageLocation] = useState(initialValues.storageLocation);
  const [isProduce, setIsProduce] = useState(initialValues.isProduce);
  const [manualExpirationDate, setManualExpirationDate] = useState(initialValues.expirationDate ?? '');
  const [showAdvanced, setShowAdvanced] = useState(initialValues.notifyDaysOverride != null);
  const [notifyDaysOverride, setNotifyDaysOverride] = useState(
    initialValues.notifyDaysOverride != null ? String(initialValues.notifyDaysOverride) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedProduceExpiry = isProduce
    ? computeExpiryDate({ isProduce: true, purchaseDate: initialValues.purchaseDate ?? undefined })
    : null;

  function handleProduceToggle(next: boolean) {
    setIsProduce(next);
    if (!next) setManualExpirationDate('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isProduce && !manualExpirationDate) {
      setError('Enter an expiration date for non-produce items.');
      return;
    }

    const expirationDate = isProduce
      ? computeExpiryDate({ isProduce: true, purchaseDate: initialValues.purchaseDate ?? undefined })
      : manualExpirationDate;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        quantity: Number(quantity) || 0,
        unit,
        storageLocation,
        isProduce,
        expirationDate,
        notifyDaysOverride: notifyDaysOverride ? Number(notifyDaysOverride) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', padding: 20 }}
    >
      <label style={{ ...labelStyle, flex: '1 1 160px' }}>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ ...labelStyle, width: 90 }}>
        Qty
        <input
          type="number"
          min="0"
          step="any"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Unit
        <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Storage
        <select value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} style={inputStyle}>
          {STORAGE_LOCATION_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isProduce} onChange={(e) => handleProduceToggle(e.target.checked)} />
        Produce (perishable)
      </label>
      {isProduce ? (
        <div style={{ ...labelStyle, minWidth: 160 }}>
          Expires
          <div style={{ ...inputStyle, background: color.muted, color: color.mutedForeground }}>
            {computedProduceExpiry} (auto)
          </div>
        </div>
      ) : (
        <label style={labelStyle}>
          Expires
          <input
            type="date"
            required
            value={manualExpirationDate}
            onChange={(e) => setManualExpirationDate(e.target.value)}
            style={inputStyle}
          />
        </label>
      )}
      <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={buttonStyle('ghost')}>
        {showAdvanced ? 'Hide advanced' : 'Advanced'}
      </button>
      {showAdvanced && (
        <label style={labelStyle}>
          Custom reminder (days before expiry)
          <input
            type="number"
            min="0"
            placeholder="Use household default"
            value={notifyDaysOverride}
            onChange={(e) => setNotifyDaysOverride(e.target.value)}
            style={inputStyle}
          />
        </label>
      )}
      <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} style={buttonStyle('ghost')}>
          Cancel
        </button>
      )}
      {error && <p style={{ color: color.destructive, width: '100%', margin: 0, fontSize: 13 }}>{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Create the location-grouped list renderer**

```tsx
// apps/web/src/components/pantry/PantryLocationGroup.tsx
'use client';

import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import type { Database } from '@pantry/supabase-client';
import { color, cardStyle, badgeStyle, buttonStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  critical: 'destructive',
  warning: 'warning',
  ok: 'success',
  unknown: 'muted',
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function PantryLocationGroup({
  icon,
  label,
  expiringSoonCount,
  items,
  onEdit,
  onConsumed,
  onExpired,
}: {
  icon: string;
  label: string;
  expiringSoonCount: number;
  items: PantryItemRow[];
  onEdit: (item: PantryItemRow) => void;
  onConsumed: (item: PantryItemRow) => void;
  onExpired: (item: PantryItemRow) => void;
}) {
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <h2 style={{ fontSize: 16, margin: 0 }}>{label}</h2>
        <span style={{ color: color.mutedForeground, fontSize: 13 }}>
          {items.length} item{items.length === 1 ? '' : 's'}
          {expiringSoonCount > 0 && `, ${expiringSoonCount} expiring soon`}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((item) => {
          const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
          return (
            <div key={item.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>
                  {item.is_produce ? '🥬 ' : ''}
                  {item.name}
                </strong>
                <span style={badgeStyle(EXPIRY_TONE[status])}>{status}</span>
              </div>
              <div style={{ color: color.mutedForeground, fontSize: 14 }}>
                {item.quantity} {item.unit}
                {item.expiration_date && ` · Expires ${item.expiration_date}`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onEdit(item)} style={buttonStyle('secondary')}>Edit</button>
                <button onClick={() => onConsumed(item)} style={buttonStyle('secondary')}>Consumed</button>
                <button onClick={() => onExpired(item)} style={buttonStyle('danger')}>Expired/Discard</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Rewrite the page to wire it all together**

Replace the full contents of `apps/web/src/app/pantry/page.tsx` with:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFreshnessFlag } from '@pantry/core';
import { groupItemsByLocation } from '@pantry/ui';
import {
  addPantryItem,
  updatePantryItem,
  archivePantryItem,
  STORAGE_LOCATION_OPTIONS,
  type Database,
} from '@pantry/supabase-client';
import { pantrySeed } from '@/data/seed';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { ItemForm, type ItemFormValues } from '@/components/pantry/ItemForm';
import { PantryLocationGroup } from '@/components/pantry/PantryLocationGroup';
import { color, cardStyle, buttonStyle, badgeStyle } from '@/lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function ItemCard({ children }: { children: React.ReactNode }) {
  return <div style={{ ...cardStyle, padding: 16, display: 'grid', gap: 6 }}>{children}</div>;
}

function DemoPantryList() {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      {pantrySeed.map((item) => {
        const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);
        const tone = flagged ? 'destructive' : item.status === 'low' ? 'warning' : 'success';

        return (
          <ItemCard key={item.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{item.name}</strong>
              <span style={badgeStyle(tone)}>{flagged ? 'flagged' : item.status}</span>
            </div>
            <div style={{ color: color.mutedForeground, fontSize: 14 }}>
              {item.quantity} {item.unit} · {item.location} · {item.category}
            </div>
            <div style={{ color: color.mutedForeground, fontSize: 13 }}>
              Last restock: {new Date(item.lastRestock).toLocaleDateString()} · Expires: {item.expiry}
            </div>
          </ItemCard>
        );
      })}
    </div>
  );
}

export default function PantryPage() {
  const { session, loading: authLoading } = useAuth();
  const { membership, create } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [editingItem, setEditingItem] = useState<PantryItemRow | null>(null);

  const refreshItems = useCallback((householdId: string) => {
    supabase
      .from('pantry_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('is_archived', false)
      .then(({ data }) => setItems(data ?? []));
  }, []);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    refreshItems(membership.householdId);
  }, [membership, refreshItems]);

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1>Pantry Inventory</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8 }}>
          Viewing demo data —{' '}
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            sign in
          </a>{' '}
          to see your household&apos;s real pantry.
        </p>
        <DemoPantryList />
      </div>
    );
  }

  async function handleAdd(values: ItemFormValues) {
    if (!membership || membership === 'loading') return;
    await addPantryItem(supabase, membership.householdId, session!.user.id, {
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      storageLocation: values.storageLocation,
      isProduce: values.isProduce,
      expirationDate: values.expirationDate,
      notifyDaysBeforeExpiry: values.notifyDaysOverride,
    });
    refreshItems(membership.householdId);
  }

  async function handleEditSave(values: ItemFormValues) {
    if (!editingItem || !membership || membership === 'loading') return;
    await updatePantryItem(supabase, editingItem.id, {
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      storageLocation: values.storageLocation,
      isProduce: values.isProduce,
      expirationDate: values.expirationDate,
      notifyDaysBeforeExpiry: values.notifyDaysOverride,
    });
    setEditingItem(null);
    refreshItems(membership.householdId);
  }

  async function handleArchive(item: PantryItemRow, eventType: 'CONSUMED' | 'SPOILED_DISCARDED') {
    if (!membership || membership === 'loading') return;
    await archivePantryItem(supabase, {
      itemId: item.id,
      householdId: membership.householdId,
      quantity: item.quantity,
      eventType,
      userId: session!.user.id,
    });
    refreshItems(membership.householdId);
  }

  const groups = groupItemsByLocation(
    items.map((item) => ({
      id: item.id,
      storageLocation: item.storage_location,
      daysUntilExpiry: daysUntil(item.expiration_date),
    })),
    STORAGE_LOCATION_OPTIONS
  );

  return (
    <div>
      <h1>Pantry Inventory</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          <div style={{ marginTop: 20 }}>
            <ItemForm submitLabel="Add item" onSubmit={handleAdd} />
          </div>
          {items.length === 0 && <p style={{ marginTop: 20, color: color.mutedForeground }}>No pantry items yet.</p>}
          {groups.map((group) => (
            <PantryLocationGroup
              key={group.location}
              icon={LOCATION_META[group.location].icon}
              label={LOCATION_META[group.location].label}
              expiringSoonCount={group.expiringSoonCount}
              items={items.filter((item) => group.itemIds.includes(item.id))}
              onEdit={setEditingItem}
              onConsumed={(item) => handleArchive(item, 'CONSUMED')}
              onExpired={(item) => handleArchive(item, 'SPOILED_DISCARDED')}
            />
          ))}
          {editingItem && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                zIndex: 50,
              }}
            >
              <div style={{ maxWidth: 640, width: '100%' }}>
                <ItemForm
                  submitLabel="Save changes"
                  onCancel={() => setEditingItem(null)}
                  initialValues={{
                    name: editingItem.name,
                    quantity: editingItem.quantity,
                    unit: editingItem.unit,
                    storageLocation: editingItem.storage_location,
                    isProduce: editingItem.is_produce,
                    expirationDate: editingItem.expiration_date,
                    notifyDaysOverride: editingItem.notify_days_before_expiry,
                    purchaseDate: editingItem.purchase_date,
                  }}
                  onSubmit={handleEditSave}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

Note: `buttonStyle` is imported but only used inside `ItemForm.tsx`/`PantryLocationGroup.tsx` in practice — keep the `page.tsx` import list exactly as shown above (`badgeStyle` and `cardStyle` are used by `DemoPantryList`/`ItemCard`; `buttonStyle` is unused in `page.tsx` itself, remove it from the import if your editor flags it as unused).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=@pantry/web`
Expected: no errors (fix the `buttonStyle` unused-import note above if it surfaces as a lint/type error)

- [ ] **Step 5: Manually verify**

Use the `run-web` skill to start the dev server and confirm, signed in with a household:
- Adding a produce item shows a read-only auto-computed expiry (today + 7 days) and the item appears under the correct location group.
- Adding a non-produce item requires picking an expiry date.
- Clicking "Edit" on an item opens the modal pre-filled; toggling produce off clears the date and requires a new one; saving updates the item in place.
- Clicking "Consumed" or "Expired/Discard" removes the item from the list immediately.
- Location groups only appear for locations that have items, each showing an item count and "N expiring soon" when applicable.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pantry/ItemForm.tsx apps/web/src/components/pantry/PantryLocationGroup.tsx apps/web/src/app/pantry/page.tsx
git commit -m "feat(web): add pantry item editing, consumed/expired actions, and location grouping"
```

---

### Task 9: Web — Notification Preferences modal

**Files:**
- Create: `apps/web/src/components/pantry/NotificationPrefsModal.tsx`
- Modify: `apps/web/src/app/pantry/page.tsx`

**Interfaces:**
- Consumes: `getHouseholdNotificationPrefs`/`updateHouseholdNotificationPrefs` (`@pantry/supabase-client`, Task 7).

- [ ] **Step 1: Create the modal**

```tsx
// apps/web/src/components/pantry/NotificationPrefsModal.tsx
'use client';

import { useEffect, useState } from 'react';
import { getHouseholdNotificationPrefs, updateHouseholdNotificationPrefs } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export function NotificationPrefsModal({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHouseholdNotificationPrefs(supabase, householdId).then((prefs) => {
      setNotifyDaysProduce(String(prefs.notifyDaysProduce));
      setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
      setLoading(false);
    });
  }, [householdId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateHouseholdNotificationPrefs(supabase, householdId, {
        notifyDaysProduce: Number(notifyDaysProduce) || 0,
        notifyDaysNonproduce: Number(notifyDaysNonproduce) || 0,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (only household owners/admins can change these settings)`
          : 'Failed to save preferences'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 50,
      }}
    >
      <div style={{ ...cardStyle, padding: 24, width: 360, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Notification preferences</h2>
        {loading ? (
          <p style={{ color: color.mutedForeground, fontSize: 13 }}>Loading…</p>
        ) : (
          <>
            <label style={labelStyle}>
              Remind me before expiry — Produce items (days)
              <input
                type="number"
                min="0"
                value={notifyDaysProduce}
                onChange={(e) => setNotifyDaysProduce(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Remind me before expiry — Non-produce items (days)
              <input
                type="number"
                min="0"
                value={notifyDaysNonproduce}
                onChange={(e) => setNotifyDaysNonproduce(e.target.value)}
                style={inputStyle}
              />
            </label>
            <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>
              This sets your reminder timing. Push/browser notifications are coming in a future
              update — for now this just saves your preference.
            </p>
            {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={buttonStyle('ghost')}>Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} style={buttonStyle('primary')}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the gear icon into the page**

In `apps/web/src/app/pantry/page.tsx`:

Add the import:
```tsx
import { NotificationPrefsModal } from '@/components/pantry/NotificationPrefsModal';
```

Add state alongside `editingItem`:
```tsx
const [showPrefs, setShowPrefs] = useState(false);
```

**Note:** `<h1>Pantry Inventory</h1>` appears twice in Task 8's `page.tsx` — once in the signed-out demo branch, once in the signed-in branch. Only change the **signed-in** one (the one immediately followed by the `{membership === 'loading' && ...}` line). Replace this exact block:
```tsx
    <div>
      <h1>Pantry Inventory</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
```
with:
```tsx
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Pantry Inventory</h1>
        {membership && membership !== 'loading' && (
          <button onClick={() => setShowPrefs(true)} style={buttonStyle('ghost')} aria-label="Notification preferences">
            ⚙️ Notifications
          </button>
        )}
      </div>
      {membership === 'loading' && <p style={{ marginTop: 20, color: color.mutedForeground }}>Loading…</p>}
```
Leave the signed-out branch's `<h1>Pantry Inventory</h1>` (inside the "Viewing demo data" block) untouched.

Add just before the closing `</>` of the signed-in branch (after the `editingItem` modal block):
```tsx
{showPrefs && membership && membership !== 'loading' && (
  <NotificationPrefsModal householdId={membership.householdId} onClose={() => setShowPrefs(false)} />
)}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@pantry/web`
Expected: no errors

- [ ] **Step 4: Manually verify**

Via `run-web`: click the gear icon, confirm the modal loads the household's current defaults (2 / 7 on a fresh household), change and save a value, close and reopen to confirm it persisted.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/pantry/NotificationPrefsModal.tsx apps/web/src/app/pantry/page.tsx
git commit -m "feat(web): add notification preferences modal to the pantry screen"
```

---

## Phase 4 — Mobile (`apps/mobile`)

### Task 10: Mobile — interactive Pantry screen (edit, lifecycle actions, location grouping)

**Files:**
- Create: `apps/mobile/src/components/pantry/ItemForm.tsx`
- Create: `apps/mobile/src/components/pantry/PantryLocationGroup.tsx`
- Modify: `apps/mobile/src/screens/PantryScreen.tsx` (whole file)

**Interfaces:**
- Mirrors Task 8 on React Native primitives, reusing the existing `ChipSelect`, `Badge`, `AppButton` components.

- [ ] **Step 1: Create the shared add/edit form**

```tsx
// apps/mobile/src/components/pantry/ItemForm.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from 'react-native';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate } from '@pantry/core';
import { ChipSelect } from '../ChipSelect';
import { AppButton } from '../AppButton';
import { color, cardStyle, inputStyle, font } from '../../lib/theme';

export interface ItemFormValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
}

export interface ItemFormInitialValues {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  notifyDaysOverride: number | null;
  purchaseDate: string | null;
}

const EMPTY_VALUES: ItemFormInitialValues = {
  name: '',
  quantity: 1,
  unit: UNIT_OPTIONS[0],
  storageLocation: STORAGE_LOCATION_OPTIONS[0],
  isProduce: true,
  expirationDate: null,
  notifyDaysOverride: null,
  purchaseDate: null,
};

export function ItemForm({
  initialValues = EMPTY_VALUES,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialValues?: ItemFormInitialValues;
  submitLabel: string;
  onSubmit: (values: ItemFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(String(initialValues.quantity));
  const [unit, setUnit] = useState(initialValues.unit);
  const [storageLocation, setStorageLocation] = useState(initialValues.storageLocation);
  const [isProduce, setIsProduce] = useState(initialValues.isProduce);
  const [manualExpirationDate, setManualExpirationDate] = useState(initialValues.expirationDate ?? '');
  const [showAdvanced, setShowAdvanced] = useState(initialValues.notifyDaysOverride != null);
  const [notifyDaysOverride, setNotifyDaysOverride] = useState(
    initialValues.notifyDaysOverride != null ? String(initialValues.notifyDaysOverride) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedProduceExpiry = isProduce
    ? computeExpiryDate({ isProduce: true, purchaseDate: initialValues.purchaseDate ?? undefined })
    : null;

  function handleProduceToggle(next: boolean) {
    setIsProduce(next);
    if (!next) setManualExpirationDate('');
  }

  async function handleSubmit() {
    setError(null);
    if (!isProduce && !manualExpirationDate) {
      setError('Enter an expiration date for non-produce items.');
      return;
    }

    const expirationDate = isProduce
      ? computeExpiryDate({ isProduce: true, purchaseDate: initialValues.purchaseDate ?? undefined })
      : manualExpirationDate;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        quantity: Number(quantity) || 0,
        unit,
        storageLocation,
        isProduce,
        expirationDate,
        notifyDaysOverride: notifyDaysOverride ? Number(notifyDaysOverride) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextInput placeholder="Name" value={name} onChangeText={setName} style={inputStyle} />
      <TextInput
        placeholder="Quantity"
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        style={inputStyle}
      />
      <Text style={styles.fieldLabel}>Unit</Text>
      <ChipSelect options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
      <Text style={styles.fieldLabel}>Storage</Text>
      <ChipSelect options={STORAGE_LOCATION_OPTIONS} value={storageLocation} onChange={setStorageLocation} />
      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Produce (perishable)</Text>
        <Switch value={isProduce} onValueChange={handleProduceToggle} />
      </View>
      {isProduce ? (
        <View>
          <Text style={styles.fieldLabel}>Expires (auto)</Text>
          <Text style={[inputStyle, styles.readonlyValue]}>{computedProduceExpiry}</Text>
        </View>
      ) : (
        <View>
          <Text style={styles.fieldLabel}>Expires (YYYY-MM-DD)</Text>
          <TextInput
            placeholder="2026-12-31"
            value={manualExpirationDate}
            onChangeText={setManualExpirationDate}
            style={inputStyle}
          />
        </View>
      )}
      <Pressable onPress={() => setShowAdvanced((v) => !v)}>
        <Text style={styles.advancedToggle}>{showAdvanced ? 'Hide advanced' : 'Advanced'}</Text>
      </Pressable>
      {showAdvanced && (
        <View>
          <Text style={styles.fieldLabel}>Custom reminder (days before expiry)</Text>
          <TextInput
            placeholder="Use household default"
            keyboardType="numeric"
            value={notifyDaysOverride}
            onChangeText={setNotifyDaysOverride}
            style={inputStyle}
          />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.buttonRow}>
        <AppButton title={submitting ? 'Saving…' : submitLabel} onPress={handleSubmit} disabled={submitting} />
        {onCancel && <AppButton title="Cancel" variant="secondary" onPress={onCancel} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { ...cardStyle, padding: 16, gap: 10 },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  readonlyValue: { color: color.mutedForeground, backgroundColor: color.muted },
  advancedToggle: { color: color.primary, fontFamily: font.semibold, fontSize: 13 },
  error: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 8 },
});
```

- [ ] **Step 2: Create the location-grouped list renderer**

```tsx
// apps/mobile/src/components/pantry/PantryLocationGroup.tsx
import { View, Text, StyleSheet } from 'react-native';
import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import type { Database } from '@pantry/supabase-client';
import { Badge } from '../Badge';
import { AppButton } from '../AppButton';
import { color, cardStyle, font } from '../../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  critical: 'destructive',
  warning: 'warning',
  ok: 'success',
  unknown: 'muted',
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function PantryLocationGroup({
  icon,
  label,
  expiringSoonCount,
  items,
  onEdit,
  onConsumed,
  onExpired,
}: {
  icon: string;
  label: string;
  expiringSoonCount: number;
  items: PantryItemRow[];
  onEdit: (item: PantryItemRow) => void;
  onConsumed: (item: PantryItemRow) => void;
  onExpired: (item: PantryItemRow) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.sectionTitle}>{label}</Text>
        <Text style={styles.summary}>
          {items.length} item{items.length === 1 ? '' : 's'}
          {expiringSoonCount > 0 ? `, ${expiringSoonCount} expiring soon` : ''}
        </Text>
      </View>
      {items.map((item) => {
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.itemHeaderRow}>
              <Text style={styles.name}>
                {item.is_produce ? '🥬 ' : ''}
                {item.name}
              </Text>
              <Badge tone={EXPIRY_TONE[status]}>{status}</Badge>
            </View>
            <Text style={styles.meta}>
              {item.quantity} {item.unit}
              {item.expiration_date && ` · Expires ${item.expiration_date}`}
            </Text>
            <View style={styles.actionsRow}>
              <AppButton title="Edit" variant="secondary" onPress={() => onEdit(item)} />
              <AppButton title="Consumed" variant="secondary" onPress={() => onConsumed(item)} />
              <AppButton title="Expired/Discard" variant="danger" onPress={() => onExpired(item)} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  icon: { fontSize: 16 },
  sectionTitle: { fontSize: 15, fontFamily: font.semibold, color: color.foreground },
  summary: { fontSize: 12, color: color.mutedForeground, fontFamily: font.regular },
  itemCard: { ...cardStyle, padding: 16, gap: 6 },
  itemHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
```

- [ ] **Step 3: Rewrite the screen to wire it all together**

Replace the full contents of `apps/mobile/src/screens/PantryScreen.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, ActivityIndicator, Pressable } from 'react-native';
import { getFreshnessFlag } from '@pantry/core';
import { groupItemsByLocation } from '@pantry/ui';
import {
  addPantryItem,
  updatePantryItem,
  archivePantryItem,
  STORAGE_LOCATION_OPTIONS,
  type Database,
} from '@pantry/supabase-client';
import { pantrySeed } from '../data/seed';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { CreateHouseholdPrompt } from '../components/CreateHouseholdPrompt';
import { Badge } from '../components/Badge';
import { ItemForm, type ItemFormValues } from '../components/pantry/ItemForm';
import { PantryLocationGroup } from '../components/pantry/PantryLocationGroup';
import { color, cardStyle, font } from '../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const LOCATION_META: Record<string, { icon: string; label: string }> = {
  FRIDGE: { icon: '🧊', label: 'Fridge' },
  FREEZER: { icon: '❄️', label: 'Freezer' },
  PANTRY: { icon: '🥫', label: 'Pantry' },
  COUNTER: { icon: '🍽️', label: 'Counter' },
  OTHER: { icon: '📦', label: 'Other' },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function DemoPantryList() {
  return (
    <>
      {pantrySeed.map((item) => {
        const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);
        const tone = flagged ? 'destructive' : item.status === 'low' ? 'warning' : 'success';

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{item.name}</Text>
              <Badge tone={tone}>{flagged ? 'flagged' : item.status}</Badge>
            </View>
            <Text style={styles.meta}>
              {item.quantity} {item.unit} · {item.location} · {item.category}
            </Text>
            <Text style={styles.meta}>
              Last restock: {new Date(item.lastRestock).toLocaleDateString()} · Expires: {item.expiry}
            </Text>
          </View>
        );
      })}
    </>
  );
}

export function PantryScreen() {
  const { session } = useAuth();
  const { membership, create } = useHousehold();
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [editingItem, setEditingItem] = useState<PantryItemRow | null>(null);

  const refreshItems = useCallback((householdId: string) => {
    supabase
      .from('pantry_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('is_archived', false)
      .then(({ data }) => setItems(data ?? []));
  }, []);

  useEffect(() => {
    if (!membership || membership === 'loading') return;
    refreshItems(membership.householdId);
  }, [membership, refreshItems]);

  // PantryScreen only renders once App.tsx has already confirmed a session
  // exists (see App.tsx's Root component), so `session` is always non-null
  // here in practice — this demo fallback covers the type only.
  if (!session) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Pantry Inventory</Text>
        <DemoPantryList />
      </ScrollView>
    );
  }

  async function handleAdd(values: ItemFormValues) {
    if (!membership || membership === 'loading') return;
    await addPantryItem(supabase, membership.householdId, session!.user.id, {
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      storageLocation: values.storageLocation,
      isProduce: values.isProduce,
      expirationDate: values.expirationDate,
      notifyDaysBeforeExpiry: values.notifyDaysOverride,
    });
    refreshItems(membership.householdId);
  }

  async function handleEditSave(values: ItemFormValues) {
    if (!editingItem || !membership || membership === 'loading') return;
    await updatePantryItem(supabase, editingItem.id, {
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      storageLocation: values.storageLocation,
      isProduce: values.isProduce,
      expirationDate: values.expirationDate,
      notifyDaysBeforeExpiry: values.notifyDaysOverride,
    });
    setEditingItem(null);
    refreshItems(membership.householdId);
  }

  async function handleArchive(item: PantryItemRow, eventType: 'CONSUMED' | 'SPOILED_DISCARDED') {
    if (!membership || membership === 'loading') return;
    await archivePantryItem(supabase, {
      itemId: item.id,
      householdId: membership.householdId,
      quantity: item.quantity,
      eventType,
      userId: session!.user.id,
    });
    refreshItems(membership.householdId);
  }

  const groups = groupItemsByLocation(
    items.map((item) => ({
      id: item.id,
      storageLocation: item.storage_location,
      daysUntilExpiry: daysUntil(item.expiration_date),
    })),
    STORAGE_LOCATION_OPTIONS
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.topHeaderRow}>
        <Text style={styles.title}>Pantry Inventory</Text>
      </View>
      {membership === 'loading' && <ActivityIndicator color={color.primary} />}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && (
        <>
          {editingItem ? (
            <ItemForm
              submitLabel="Save changes"
              onCancel={() => setEditingItem(null)}
              initialValues={{
                name: editingItem.name,
                quantity: editingItem.quantity,
                unit: editingItem.unit,
                storageLocation: editingItem.storage_location,
                isProduce: editingItem.is_produce,
                expirationDate: editingItem.expiration_date,
                notifyDaysOverride: editingItem.notify_days_before_expiry,
                purchaseDate: editingItem.purchase_date,
              }}
              onSubmit={handleEditSave}
            />
          ) : (
            <ItemForm submitLabel="Add item" onSubmit={handleAdd} />
          )}
          {items.length === 0 && <Text style={styles.meta}>No pantry items yet.</Text>}
          {groups.map((group) => (
            <PantryLocationGroup
              key={group.location}
              icon={LOCATION_META[group.location].icon}
              label={LOCATION_META[group.location].label}
              expiringSoonCount={group.expiringSoonCount}
              items={items.filter((item) => group.itemIds.includes(item.id))}
              onEdit={setEditingItem}
              onConsumed={(item) => handleArchive(item, 'CONSUMED')}
              onExpired={(item) => handleArchive(item, 'SPOILED_DISCARDED')}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 12 },
  topHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground, marginBottom: 8 },
  itemCard: { ...cardStyle, padding: 16, gap: 6 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
});
```

(The gear icon and its `Pressable` are added in Task 11 alongside the `NotificationPrefsModal`, inside `topHeaderRow`.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=@pantry/mobile`
Expected: no errors

- [ ] **Step 5: Manually verify**

Use the `run-mobile` skill to start Expo and confirm the same behaviors as Task 8's manual verification, on the mobile UI.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/pantry/ItemForm.tsx apps/mobile/src/components/pantry/PantryLocationGroup.tsx apps/mobile/src/screens/PantryScreen.tsx
git commit -m "feat(mobile): add pantry item editing, consumed/expired actions, and location grouping"
```

---

### Task 11: Mobile — Notification Preferences modal

**Files:**
- Create: `apps/mobile/src/components/pantry/NotificationPrefsModal.tsx`
- Modify: `apps/mobile/src/screens/PantryScreen.tsx`

**Interfaces:**
- Mirrors Task 9 using React Native's `Modal`.

- [ ] **Step 1: Create the modal**

```tsx
// apps/mobile/src/components/pantry/NotificationPrefsModal.tsx
import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet } from 'react-native';
import { getHouseholdNotificationPrefs, updateHouseholdNotificationPrefs } from '@pantry/supabase-client';
import { supabase } from '../../lib/supabaseClient';
import { AppButton } from '../AppButton';
import { color, cardStyle, inputStyle, font } from '../../lib/theme';

export function NotificationPrefsModal({
  householdId,
  visible,
  onClose,
}: {
  householdId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getHouseholdNotificationPrefs(supabase, householdId).then((prefs) => {
      setNotifyDaysProduce(String(prefs.notifyDaysProduce));
      setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
      setLoading(false);
    });
  }, [visible, householdId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateHouseholdNotificationPrefs(supabase, householdId, {
        notifyDaysProduce: Number(notifyDaysProduce) || 0,
        notifyDaysNonproduce: Number(notifyDaysNonproduce) || 0,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (only household owners/admins can change these settings)`
          : 'Failed to save preferences'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Notification preferences</Text>
          {loading ? (
            <Text style={styles.meta}>Loading…</Text>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Remind me before expiry — Produce items (days)</Text>
              <TextInput
                keyboardType="numeric"
                value={notifyDaysProduce}
                onChangeText={setNotifyDaysProduce}
                style={inputStyle}
              />
              <Text style={styles.fieldLabel}>Remind me before expiry — Non-produce items (days)</Text>
              <TextInput
                keyboardType="numeric"
                value={notifyDaysNonproduce}
                onChangeText={setNotifyDaysNonproduce}
                style={inputStyle}
              />
              <Text style={styles.hint}>
                This sets your reminder timing. Push notifications are coming in a future update —
                for now this just saves your preference.
              </Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.buttonRow}>
                <AppButton title="Cancel" variant="secondary" onPress={onClose} />
                <AppButton title={saving ? 'Saving…' : 'Save'} onPress={handleSave} disabled={saving} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { ...cardStyle, backgroundColor: color.card, padding: 20, width: '100%', maxWidth: 360, gap: 10 },
  title: { fontSize: 16, fontFamily: font.bold, color: color.foreground },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  hint: { color: color.mutedForeground, fontSize: 12, fontFamily: font.regular },
  error: { color: color.destructive, fontSize: 13, fontFamily: font.regular },
  buttonRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
});
```

- [ ] **Step 2: Wire the gear icon into the screen**

In `apps/mobile/src/screens/PantryScreen.tsx`:

Add the import:
```tsx
import { NotificationPrefsModal } from '../components/pantry/NotificationPrefsModal';
```

Add state alongside `editingItem`:
```tsx
const [showPrefs, setShowPrefs] = useState(false);
```

Replace the `topHeaderRow` block with:
```tsx
<View style={styles.topHeaderRow}>
  <Text style={styles.title}>Pantry Inventory</Text>
  {membership && membership !== 'loading' && (
    <Pressable onPress={() => setShowPrefs(true)}>
      <Text style={styles.gearIcon}>⚙️</Text>
    </Pressable>
  )}
</View>
```

Add `gearIcon: { fontSize: 20 },` to the `StyleSheet.create` call.

Add just after the closing `</>` fragment's last child (inside the signed-in-and-membership-ready branch, after the `groups.map(...)` block):
```tsx
<NotificationPrefsModal
  householdId={membership.householdId}
  visible={showPrefs}
  onClose={() => setShowPrefs(false)}
/>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@pantry/mobile`
Expected: no errors

- [ ] **Step 4: Manually verify**

Via `run-mobile`: tap the gear icon, confirm the modal loads current defaults, change and save, reopen to confirm persistence, and confirm it renders correctly as a native modal (dims background, centers card).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/pantry/NotificationPrefsModal.tsx apps/mobile/src/screens/PantryScreen.tsx
git commit -m "feat(mobile): add notification preferences modal to the pantry screen"
```

---

## Phase 5 — Visual polish

### Task 12: Visual redesign pass on both platforms

**Files:**
- Modify: `apps/web/src/components/pantry/PantryLocationGroup.tsx`, `apps/web/src/app/pantry/page.tsx`
- Modify: `apps/mobile/src/components/pantry/PantryLocationGroup.tsx`, `apps/mobile/src/screens/PantryScreen.tsx`

**Interfaces:**
- No new interfaces — purely visual/styling changes on top of Tasks 8–11's working functionality.

- [ ] **Step 1: Invoke the styling skill**

Run the `ui-ux-pro-max:ui-styling` skill against the now-functional, location-grouped Pantry screen on both platforms. Ask it to refine spacing, per-location visual accents, and overall polish while extending — not replacing — the existing "Grocery-fresh" palette and Plus Jakarta Sans typography defined in `apps/web/src/lib/theme.ts` and `apps/mobile/src/lib/theme.ts`. Do not change the palette's actual color values or introduce a new font; this task is about layout/spacing/visual-hierarchy refinement of the components built in Tasks 8 and 10.

- [ ] **Step 2: Manually verify on both platforms**

Use `run-web` and `run-mobile` to screenshot the resulting Pantry screen (with a household that has items in at least two different storage locations, including at least one expiring-soon item) and confirm it reads clearly at both desktop and phone widths (mobile) / down to ~400px (web).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/pantry apps/web/src/app/pantry/page.tsx apps/mobile/src/components/pantry apps/mobile/src/screens/PantryScreen.tsx
git commit -m "style: polish the location-grouped pantry screen on web and mobile"
```
