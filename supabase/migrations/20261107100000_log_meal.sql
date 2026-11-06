-- Life OS — Phase 2B: log meals atomically, save roster meals atomically
--
-- Both functions are SECURITY INVOKER: they run as the signed-in user, so every insert still
-- goes through RLS (owner-only + active health_data consent + can_use_food).

-- A plan meal needs a usual time to appear on the Today timeline.
alter table public.saved_meals
  add constraint saved_meals_plan_has_time check (not in_daily_plan or usual_time is not null);

-- ---------------------------------------------------------------------------
-- log_meal: meal_logs + snapshotted meal_log_items + food_portions_last, in one transaction.
--
-- p_items: [{ "food_id": uuid, "grams": number, "kcal": int, "protein": num, "carbs": num, "fat": num }]
-- The client computes macros with @life-os/core (portionMacros). The server recomputes them
-- from the food's current per-100 g values with the same rounding (whole kcal, 1 dp macros,
-- half away from zero) and rejects any mismatch, so a stale or tampered client can't log
-- numbers that don't match the food. The server's values are stored.
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

    -- Same maths as @life-os/core portionMacros. numeric round() is half away from zero.
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
      (meal_log_id, food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g, position)
    values (
      v_log_id, v_food.id, left(coalesce(nullif(btrim(v_food.name), ''), 'Unnamed food'), 200),
      v_grams, v_kcal, v_protein, v_carbs, v_fat, v_pos
    );

    -- Remember the amount for "last time" suggestions; an older back-dated log doesn't win.
    insert into public.food_portions_last (food_id, grams, logged_at)
    values (v_food.id, v_grams, v_logged_at)
    on conflict (user_id, food_id) do update
      set grams = excluded.grams, logged_at = excluded.logged_at
      where public.food_portions_last.logged_at <= excluded.logged_at;

    v_pos := v_pos + 1;
  end loop;

  return v_log_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_meal: create or update a roster meal and replace its components, atomically.
-- p_components: [{ "food_id": uuid, "grams": number }]
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
  insert into public.saved_meal_components (saved_meal_id, food_id, grams, position)
  select v_id, (c.value ->> 'food_id')::uuid, round((c.value ->> 'grams')::numeric, 1), (c.ordinality - 1)::smallint
  from jsonb_array_elements(p_components) with ordinality as c(value, ordinality);

  return v_id;
end;
$$;

revoke all on function public.log_meal(text, uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.save_meal(uuid, text, boolean, time, jsonb) from public, anon;
grant execute on function public.log_meal(text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.save_meal(uuid, text, boolean, time, jsonb) to authenticated;
