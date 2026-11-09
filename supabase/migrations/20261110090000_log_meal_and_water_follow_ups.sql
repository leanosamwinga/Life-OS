-- Life OS — Log meal and water follow-ups (after PR #9)
--
--   * replace_logged_meal (7j "Log a corrected copy"): log a new meal and delete the old one in
--     one transaction. Amounts stay locked in 7k; this is the one-tap way to delete and log
--     again. It runs the same checks as log_meal (signed in, consent through RLS, the new time
--     inside the window, macros recomputed from the foods' current per-100 values and any
--     mismatch refused) and delete_logged_meal (owner through RLS, active health_data consent,
--     the old meal inside the window). The new meal keeps the old one's saved_meal_id, so a plan
--     meal stays "eaten". If anything fails, nothing changes.
--   * Water delete (2 Health → today's water) needs no change: the existing
--     "water_logs: owner with health consent" policy (for all) already limits delete to the
--     owner with an active health_data consent, and authenticated has delete on the table.

create or replace function public.replace_logged_meal(
  p_old_id uuid,
  p_name text,
  p_logged_at timestamptz,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_saved_meal_id uuid;
  v_new_id uuid;
begin
  -- Signed in, active health_data consent, the old meal is yours (RLS) and inside the window.
  perform public.lock_logged_meal(p_old_id, 'correct');
  select saved_meal_id into v_saved_meal_id from public.meal_logs where id = p_old_id;

  -- The new meal: log_meal's own checks (time window, components, recomputed macros).
  v_new_id := public.log_meal(p_name, v_saved_meal_id, p_logged_at, p_items);

  perform set_config('lifeos.edit_meal_log', 'on', true);
  delete from public.meal_logs where id = p_old_id;
  perform set_config('lifeos.edit_meal_log', 'off', true);

  return v_new_id;
end;
$$;

comment on function public.replace_logged_meal(uuid, text, timestamptz, jsonb) is
  '7j "Log a corrected copy": log_meal + delete_logged_meal in one transaction, keeping the plan link.';

revoke all on function public.replace_logged_meal(uuid, text, timestamptz, jsonb) from public, anon;
grant execute on function public.replace_logged_meal(uuid, text, timestamptz, jsonb) to authenticated;
