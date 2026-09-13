create view v_household_financials as
select
  household_id,
  sum(value_delta) filter (where event_type = 'CONSUMED') as consumed_value,
  sum(value_delta) filter (where event_type in ('EXPIRED', 'SPOILED_DISCARDED')) as wasted_value
from inventory_movement_logs
group by household_id;
