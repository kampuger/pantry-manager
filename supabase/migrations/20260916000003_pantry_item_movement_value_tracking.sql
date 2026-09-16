-- =========================================================
-- LOG A PURCHASED MOVEMENT WHEN AN ITEM IS ADDED
-- =========================================================
-- inventory_movement_logs already had a PURCHASED event type and a
-- value_delta column, but nothing ever wrote to either — addPantryItem()
-- just inserts the row and stops. A trigger keeps this atomic with the
-- insert and needs no change to the client's insert-and-return call shape.
create or replace function log_pantry_item_purchase()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into inventory_movement_logs (
    household_id, pantry_item_id, event_type, quantity_delta, value_delta, triggered_by
  )
  values (
    new.household_id,
    new.id,
    'PURCHASED',
    new.quantity,
    new.purchase_price,
    new.created_by
  );
  return new;
end;
$$;

create trigger trg_log_pantry_item_purchase
  after insert on pantry_items
  for each row
  execute function log_pantry_item_purchase();

comment on function log_pantry_item_purchase is
  'Records a PURCHASED movement log entry whenever a pantry item is added, carrying its price into value_delta so the financial page can total actual spend rather than just consumed/wasted value.';

-- =========================================================
-- ARCHIVE PANTRY ITEM: also carry the item's price into value_delta
-- =========================================================
-- value_delta is a positive magnitude ("how much money moved in this
-- event"), matching computeConsumedValue/computeWastedValue in
-- packages/core/src/financial.ts — unlike quantity_delta, it is not negated
-- for a consumption/discard event.
create or replace function archive_pantry_item(
  p_item_id uuid,
  p_event_type text,
  p_quantity numeric,
  p_triggered_by uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_household_id uuid;
  v_purchase_price numeric;
begin
  select household_id, purchase_price into v_household_id, v_purchase_price
  from pantry_items where id = p_item_id;
  if v_household_id is null then
    raise exception 'pantry item % not found', p_item_id;
  end if;

  if not is_household_member(v_household_id) then
    raise exception 'not authorized to archive pantry item %', p_item_id;
  end if;

  update pantry_items set is_archived = true where id = p_item_id;

  insert into inventory_movement_logs (
    household_id, pantry_item_id, event_type, quantity_delta, value_delta, triggered_by
  )
  values (
    v_household_id,
    p_item_id,
    p_event_type::movement_event_type,
    -abs(p_quantity),
    v_purchase_price,
    p_triggered_by
  );

  delete from pantry_item_reminders where pantry_item_id = p_item_id;
end;
$$;

comment on function archive_pantry_item is
  'Atomically archives a pantry item, records its consumed/discarded movement log entry (value_delta carries the item''s price for financial reporting), and clears any pending reminder for it — all in one transaction.';
