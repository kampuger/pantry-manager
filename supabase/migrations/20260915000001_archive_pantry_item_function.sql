-- =========================================================
-- ARCHIVE PANTRY ITEM (atomic archive + audit-log write)
-- =========================================================
-- Marking an item Consumed/Discarded has to flip pantry_items.is_archived AND
-- append an inventory_movement_logs row. Done as two client-side writes those
-- can drift apart (item archived, no audit trail, no compensating path), so
-- both statements live in one function and therefore one transaction.
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
begin
  select household_id into v_household_id from pantry_items where id = p_item_id;
  if v_household_id is null then
    raise exception 'pantry item % not found', p_item_id;
  end if;

  -- security definer bypasses RLS, so re-apply the same membership gate the
  -- "members can update pantry items" and "members can insert movement logs"
  -- policies enforce for direct table access.
  if not is_household_member(v_household_id) then
    raise exception 'not authorized to archive pantry item %', p_item_id;
  end if;

  update pantry_items set is_archived = true where id = p_item_id;

  insert into inventory_movement_logs (
    household_id, pantry_item_id, event_type, quantity_delta, triggered_by
  )
  values (
    v_household_id,
    p_item_id,
    p_event_type::movement_event_type,
    -abs(p_quantity),
    p_triggered_by
  );
end;
$$;

comment on function archive_pantry_item is
  'Atomically archives a pantry item and records its consumed/discarded movement log entry in one transaction.';

grant execute on function archive_pantry_item(uuid, text, numeric, uuid) to authenticated;
