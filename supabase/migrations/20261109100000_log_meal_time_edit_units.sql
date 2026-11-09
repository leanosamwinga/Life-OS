-- Life OS — Log meal follow-up: custom time, open and edit a logged meal, g or ml
-- (docs: claude/log-meal-time-edit-units-decisions.md; wireframes 7a-T, 7i, 7b-T, 7j, 7k, 7l, -U)
--
--   * A meal's time: from yesterday 00:00 (Europe/London) up to one hour from now. log_meal and
--     update_logged_meal both refuse anything outside that window (plus two minutes' grace for a
--     phone clock that runs a little fast). The app's picker (7i) uses the same window.
--   * Edit a logged meal: name, time and each item's unit only, through update_logged_meal.
--     Amounts and components are locked by a guard trigger: to change them, delete the meal and
--     log it again. edited_at is internal bookkeeping; the app never shows it.
--   * Delete: an ordinary delete on meal_logs (RLS: owner + health consent); items cascade. A plan
--     meal shows as not eaten again simply because no log references it any more.
--   * g or ml: every food has a nutrition unit (per 100 g or per 100 ml; existing foods are g,
--     batches are always g). Amounts carry a unit label everywhere they're stored. 1 ml counts as
--     1 g, so the maths never changes; the amount stays in the `grams` columns (to 1 dp).
--     Pack and serving sizes are in the food's unit (a 330 ml bottle: pack_g = 330, unit ml).

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------

alter table public.foods
  add column nutrition_unit text not null default 'g' check (nutrition_unit in ('g', 'ml')),
  add constraint foods_batch_unit_g check (not is_batch or nutrition_unit = 'g');

comment on column public.foods.nutrition_unit is
  'Whether the *_per_100g values are per 100 g or per 100 ml. 1 ml counts as 1 g.';
comment on column public.foods.pack_g is 'Whole pack in the food''s nutrition_unit (g or ml).';
comment on column public.foods.serving_g is 'One serving in the food''s nutrition_unit (g or ml).';

alter table public.meal_log_items
  add column unit text not null default 'g' check (unit in ('g', 'ml'));
alter table public.saved_meal_components
  add column unit text not null default 'g' check (unit in ('g', 'ml'));
alter table public.food_portions_last
  add column unit text not null default 'g' check (unit in ('g', 'ml'));

comment on column public.meal_log_items.unit is 'Label for grams: g or ml (1 ml counts as 1 g).';

-- ---------------------------------------------------------------------------
-- Edited-at bookkeeping (internal; never shown)
-- ---------------------------------------------------------------------------

alter table public.meal_logs add column edited_at timestamptz;

-- ---------------------------------------------------------------------------
-- The time window
-- ---------------------------------------------------------------------------

create or replace function public.check_meal_time(p_at timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_earliest timestamptz :=
    ((now() at time zone 'Europe/London')::date - 1)::timestamp at time zone 'Europe/London';
  v_latest timestamptz := now() + interval '1 hour' + interval '2 minutes';
begin
  if p_at is null or p_at < v_earliest then
    raise exception 'pick a time from yesterday 00:00 onwards' using errcode = '22023';
  end if;
  if p_at > v_latest then
    raise exception 'pick a time no more than an hour from now' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.check_meal_time(timestamptz) from public, anon;
grant execute on function public.check_meal_time(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- log_meal: as before (20261107100000_log_meal.sql), plus the time window and each item's unit.
--
-- p_items: [{ "food_id": uuid, "grams": number, "unit": "g"|"ml" (optional: the food's unit),
--             "kcal": int, "protein": num, "carbs": num, "fat": num }]
-- ---------------------------------------------------------------------------
create or replace function public.log_meal(
  p_name text,
  p_saved_meal_id uuid,
  p_logged_at timestamptz,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log_id uuid;
  v_logged_at timestamptz := coalesce(p_logged_at, now());
  v_item jsonb;
  v_pos integer := 0;
  v_food public.foods%rowtype;
  v_food_id uuid;
  v_grams numeric;
  v_unit text;
  v_kcal integer;
  v_protein numeric;
  v_carbs numeric;
  v_fat numeric;
begin
  if auth.uid() is null then
    raise exception 'sign in to log meals' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a meal needs at least one component' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'a meal can have at most 50 components' using errcode = '22023';
  end if;
  perform public.check_meal_time(v_logged_at);

  -- RLS on meal_logs enforces ownership, consent and that p_saved_meal_id is the caller's.
  insert into public.meal_logs (name, saved_meal_id, logged_at)
  values (btrim(p_name), p_saved_meal_id, v_logged_at)
  returning id into v_log_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_food_id := (v_item ->> 'food_id')::uuid;
      v_grams := round((v_item ->> 'grams')::numeric, 1);
    exception when others then
      raise exception 'component % is malformed', v_pos + 1 using errcode = '22023';
    end;
    if v_food_id is null or v_grams is null or v_grams <= 0 or v_grams > 5000 then
      raise exception 'component % needs a food and 0.1–5000 g', v_pos + 1 using errcode = '22023';
    end if;

    -- RLS on foods: only the global cache and the caller's own foods are visible.
    select * into v_food from public.foods where id = v_food_id;
    if not found then
      raise exception 'component %: unknown food', v_pos + 1 using errcode = '22023';
    end if;
    if v_food.kcal_per_100g is null or v_food.protein_per_100g is null
       or v_food.carbs_per_100g is null or v_food.fat_per_100g is null then
      raise exception 'component %: % is missing nutrition values', v_pos + 1, coalesce(v_food.name, 'this food')
        using errcode = '22023';
    end if;

    v_unit := coalesce(v_item ->> 'unit', v_food.nutrition_unit);
    if v_unit not in ('g', 'ml') then
      raise exception 'component %: the unit must be g or ml', v_pos + 1 using errcode = '22023';
    end if;

    -- Same maths as @life-os/core portionMacros (1 ml counts as 1 g). Half away from zero.
    v_kcal := round(v_food.kcal_per_100g * v_grams / 100, 0);
    v_protein := round(v_food.protein_per_100g * v_grams / 100, 1);
    v_carbs := round(v_food.carbs_per_100g * v_grams / 100, 1);
    v_fat := round(v_food.fat_per_100g * v_grams / 100, 1);

    if (v_item ->> 'kcal') is null or (v_item ->> 'protein') is null
       or (v_item ->> 'carbs') is null or (v_item ->> 'fat') is null
       or (v_item ->> 'kcal')::numeric <> v_kcal
       or (v_item ->> 'protein')::numeric <> v_protein
       or (v_item ->> 'carbs')::numeric <> v_carbs
       or (v_item ->> 'fat')::numeric <> v_fat then
      raise exception 'component %: nutrition for % has changed; refresh and try again',
        v_pos + 1, coalesce(v_food.name, 'this food')
        using errcode = '22023';
    end if;

    insert into public.meal_log_items
      (meal_log_id, food_id, food_name, grams, unit, kcal, protein_g, carbs_g, fat_g, position)
    values (
      v_log_id, v_food.id, left(coalesce(nullif(btrim(v_food.name), ''), 'Unnamed food'), 200),
      v_grams, v_unit, v_kcal, v_protein, v_carbs, v_fat, v_pos
    );

    -- Remember the amount (and its unit) for "last time"; an older back-dated log doesn't win.
    insert into public.food_portions_last (food_id, grams, unit, logged_at)
    values (v_food.id, v_grams, v_unit, v_logged_at)
    on conflict (user_id, food_id) do update
      set grams = excluded.grams, unit = excluded.unit, logged_at = excluded.logged_at
      where public.food_portions_last.logged_at <= excluded.logged_at;

    v_pos := v_pos + 1;
  end loop;

  return v_log_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_meal: as before, plus each component's unit.
-- p_components: [{ "food_id": uuid, "grams": number, "unit": "g"|"ml" (optional: the food's) }]
-- ---------------------------------------------------------------------------
create or replace function public.save_meal(
  p_id uuid,
  p_name text,
  p_in_daily_plan boolean,
  p_usual_time time,
  p_components jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in to save meals' using errcode = '42501';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array'
     or jsonb_array_length(p_components) = 0 then
    raise exception 'a meal needs at least one component' using errcode = '22023';
  end if;
  if jsonb_array_length(p_components) > 50 then
    raise exception 'a meal can have at most 50 components' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_components) c
    where c.value ? 'unit' and c.value ->> 'unit' not in ('g', 'ml')
  ) then
    raise exception 'the unit must be g or ml' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.saved_meals (name, in_daily_plan, usual_time, sort_order)
    values (
      btrim(p_name), coalesce(p_in_daily_plan, false), p_usual_time,
      coalesce((select max(sort_order) + 1 from public.saved_meals), 0)
    )
    returning id into v_id;
  else
    update public.saved_meals
      set name = btrim(p_name), in_daily_plan = coalesce(p_in_daily_plan, false), usual_time = p_usual_time
      where id = p_id
      returning id into v_id;
    if v_id is null then
      raise exception 'meal not found' using errcode = 'P0002';
    end if;
    delete from public.saved_meal_components where saved_meal_id = v_id;
  end if;

  -- RLS (with check) enforces consent and can_use_food for each component.
  insert into public.saved_meal_components (saved_meal_id, food_id, grams, unit, position)
  select
    v_id,
    (c.value ->> 'food_id')::uuid,
    round((c.value ->> 'grams')::numeric, 1),
    coalesce(
      c.value ->> 'unit',
      (select f.nutrition_unit from public.foods f where f.id = (c.value ->> 'food_id')::uuid),
      'g'
    ),
    (c.ordinality - 1)::smallint
  from jsonb_array_elements(p_components) with ordinality as c(value, ordinality);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Logged amounts are locked: an item may only change its unit label. (Its food_id may still be
-- set to NULL by the foreign key when the food is deleted.) Edits that would change amounts or
-- components are refused: delete the meal and log it again.
-- ---------------------------------------------------------------------------
create or replace function public.meal_log_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.food_id is null or new.food_id = old.food_id)
     and (to_jsonb(new) - 'unit' - 'updated_at' - 'food_id')
       = (to_jsonb(old) - 'unit' - 'updated_at' - 'food_id') then
    return new;
  end if;
  raise exception 'logged amounts can''t be changed; delete the meal and log it again'
    using errcode = '42501';
end;
$$;

create trigger meal_log_items_guard before update on public.meal_log_items
  for each row execute function public.meal_log_items_guard();

-- A logged meal's time stays inside the window when it changes, however it's changed.
create or replace function public.meal_logs_time_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.logged_at is distinct from old.logged_at then
    perform public.check_meal_time(new.logged_at);
  end if;
  return new;
end;
$$;

create trigger meal_logs_time_guard before update of logged_at on public.meal_logs
  for each row execute function public.meal_logs_time_guard();

-- ---------------------------------------------------------------------------
-- update_logged_meal (7k): name, time and each item's unit, in one transaction.
--
-- p_logged_at: the new time, or NULL to keep it. The time never changes unless the user changed
--   it; a new time must be in the window.
-- p_units: [{ "position": int, "unit": "g"|"ml" }] — only the items whose label changes.
-- Never touches the saved meal or plan meal the log came from.
-- ---------------------------------------------------------------------------
create or replace function public.update_logged_meal(
  p_id uuid,
  p_name text,
  p_logged_at timestamptz,
  p_units jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old timestamptz;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'sign in to edit meals' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'give the meal a name' using errcode = '22023';
  end if;
  if p_units is not null and (
    jsonb_typeof(p_units) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(p_units) u
      where u.value ->> 'unit' is null or u.value ->> 'unit' not in ('g', 'ml')
         or jsonb_typeof(u.value -> 'position') <> 'number'
    )
  ) then
    raise exception 'the unit must be g or ml' using errcode = '22023';
  end if;

  -- RLS: only your own logs, with health consent.
  select logged_at into v_old from public.meal_logs where id = p_id for update;
  if not found then
    raise exception 'meal not found' using errcode = 'P0002';
  end if;

  update public.meal_logs
    set name = v_name,
        logged_at = coalesce(p_logged_at, v_old),
        edited_at = now()
    where id = p_id;

  if p_units is not null then
    update public.meal_log_items i
      set unit = u.value ->> 'unit'
      from jsonb_array_elements(p_units) u
      where i.meal_log_id = p_id
        and i.position = (u.value ->> 'position')::int
        and i.unit is distinct from u.value ->> 'unit';
  end if;
end;
$$;

revoke all on function public.log_meal(text, uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.save_meal(uuid, text, boolean, time, jsonb) from public, anon;
revoke all on function public.update_logged_meal(uuid, text, timestamptz, jsonb) from public, anon;
grant execute on function public.log_meal(text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.save_meal(uuid, text, boolean, time, jsonb) to authenticated;
grant execute on function public.update_logged_meal(uuid, text, timestamptz, jsonb) to authenticated;
