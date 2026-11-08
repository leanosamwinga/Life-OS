-- Life OS — Log meal follow-up: save without logging, batches, stars ("Saved" tab)
--
--   * Stars on saved meals and batches: starred first, then A–Z on the Saved tab (7a-S).
--   * A batch (one pot cooked once, logged by the gram — wireframes 7f–7h) is the user's own food
--     (`foods.is_batch`) whose per-100 g values are its ingredients' totals ÷ the cooked weight.
--     The cooked weight is the user's own weighing or an estimate from dry→cooked ratios
--     (`cooked_weight_weighed`). No portions, no "what's left", no expiry.
--   * Ingredients live in `batch_ingredients`, a health table: owner only, active health_data
--     consent, composite FK so an ingredient can't hang off someone else's batch.
--   * Batches are written only through `save_batch` (SECURITY INVOKER, so RLS applies), which
--     recomputes the per-100 g values from the ingredients' foods and the cooked weight — the same
--     maths as @life-os/core (packages/core/src/batch.ts) — and refuses any mismatch. A guard
--     trigger stops batch rows being created or changed any other way (starring excepted).
--   * Cooking again updates the batch in place. Meals already logged keep their snapshot
--     (meal_log_items); nothing in history is rewritten.

-- ---------------------------------------------------------------------------
-- Stars
-- ---------------------------------------------------------------------------

alter table public.saved_meals add column starred boolean not null default false;

-- ---------------------------------------------------------------------------
-- Batches are foods
-- ---------------------------------------------------------------------------

alter table public.foods
  add column is_batch boolean not null default false,
  add column cooked_weight_g numeric(7, 1) check (cooked_weight_g > 0 and cooked_weight_g <= 50000),
  add column cooked_weight_weighed boolean,
  add column cooked_at timestamptz,
  add column starred boolean not null default false,
  add constraint foods_batch_shape check (
    case
      when is_batch then
        user_id is not null and source = 'user' and barcode is null and name is not null
        and cooked_weight_g is not null and cooked_weight_weighed is not null and cooked_at is not null
      else
        cooked_weight_g is null and cooked_weight_weighed is null and cooked_at is null and not starred
    end
  ),
  -- Lets batch_ingredients use a composite FK (batch_id, user_id).
  add constraint foods_id_user_key unique (id, user_id);

create index foods_user_batches_idx on public.foods (user_id) where is_batch;

-- ---------------------------------------------------------------------------
-- batch_ingredients (health data)
-- ---------------------------------------------------------------------------

create table public.batch_ingredients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid not null default auth.uid(),
  food_id uuid not null,
  -- As it went in the pot. Liquids: 1 ml = 1 g.
  grams numeric(7, 1) not null check (grams > 0 and grams <= 5000),
  -- The ratio-table entry used for the cooked-weight estimate ('as_added' = its own weight),
  -- and the ratio itself. Both visible and correctable in the app (7f).
  cooks_as text not null default 'as_added' check (cooks_as ~ '^[a-z_]{1,32}$'),
  cooked_ratio numeric(3, 2) not null default 1 check (cooked_ratio > 0 and cooked_ratio <= 5),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint batch_ingredients_as_added_is_one check (cooks_as <> 'as_added' or cooked_ratio = 1),
  -- Composite FK: an ingredient belongs to a batch of the same user.
  constraint batch_ingredients_batch_fkey foreign key (batch_id, user_id)
    references public.foods (id, user_id) on delete cascade,
  constraint batch_ingredients_food_id_fkey foreign key (food_id) references public.foods (id)
);

create index batch_ingredients_batch_idx on public.batch_ingredients (batch_id, position);
create index batch_ingredients_food_idx on public.batch_ingredients (food_id);

create trigger set_updated_at before update on public.batch_ingredients
  for each row execute function public.set_updated_at();

revoke all on public.batch_ingredients from anon;
grant select, insert, update, delete on public.batch_ingredients to authenticated;
grant all on public.batch_ingredients to service_role;

alter table public.batch_ingredients enable row level security;

create policy "batch_ingredients: owner with health consent" on public.batch_ingredients
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (
    user_id = (select auth.uid())
    and (select public.has_active_consent('health_data'))
    and public.can_use_food(food_id)
  );

-- ---------------------------------------------------------------------------
-- foods policies: a batch is health data, so it needs an active consent like saved meals do.
-- Global cache rows and ordinary own foods are unchanged.
-- ---------------------------------------------------------------------------

drop policy "foods: read global cache and own foods" on public.foods;
drop policy "foods: owner can insert" on public.foods;
drop policy "foods: owner can update" on public.foods;
drop policy "foods: owner can delete" on public.foods;

create policy "foods: read global cache and own foods" on public.foods
  for select to authenticated
  using (
    user_id is null
    or (
      user_id = (select auth.uid())
      and (not is_batch or (select public.has_active_consent('health_data')))
    )
  );
create policy "foods: owner can insert" on public.foods
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and source = 'user'
    and (not is_batch or (select public.has_active_consent('health_data')))
  );
create policy "foods: owner can update" on public.foods
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (not is_batch or (select public.has_active_consent('health_data')))
  )
  with check (
    user_id = (select auth.uid()) and source = 'user'
    and (not is_batch or (select public.has_active_consent('health_data')))
  );
create policy "foods: owner can delete" on public.foods
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (not is_batch or (select public.has_active_consent('health_data')))
  );

-- ---------------------------------------------------------------------------
-- Guard: batch rows change only inside save_batch (which sets lifeos.save_batch for its own
-- transaction). The one exception is starring, which changes nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.foods_batch_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (new.is_batch or (tg_op = 'UPDATE' and old.is_batch)) then
    return new;
  end if;
  if coalesce(current_setting('lifeos.save_batch', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_batch and new.is_batch
     and (to_jsonb(new) - 'starred' - 'updated_at') = (to_jsonb(old) - 'starred' - 'updated_at') then
    return new;
  end if;
  raise exception 'batches are saved through save_batch' using errcode = '42501';
end;
$$;

create trigger foods_batch_guard before insert or update on public.foods
  for each row execute function public.foods_batch_guard();

-- Ingredients too: adding or changing one outside save_batch would leave the batch's per-100 g
-- values out of step. Deleting the whole batch (which cascades here) is fine.
create or replace function public.batch_ingredients_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('lifeos.save_batch', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.foods where id = old.batch_id) then
    return old;
  end if;
  raise exception 'batches are saved through save_batch' using errcode = '42501';
end;
$$;

create trigger batch_ingredients_guard before insert or update or delete on public.batch_ingredients
  for each row execute function public.batch_ingredients_guard();

-- ---------------------------------------------------------------------------
-- save_batch: create a batch, or cook it again (replace its ingredients), atomically.
--
-- p_ingredients: [{ "food_id": uuid, "grams": number, "cooks_as": text, "cooked_ratio": number }]
-- p_cooked_weight_g: the weighed value when p_weighed, else the client's estimate (checked).
-- p_per_100g: { "kcal": int, "protein": num, "carbs": num, "fat": num } from @life-os/core.
--
-- The server recomputes, from the ingredients' current foods:
--   whole batch   = Σ each ingredient's portion (whole kcal, 1 dp macros, half away from zero)
--   estimate      = Σ grams × ratio → nearest 10 g (under 100 g: nearest gram, at least 1)
--   cooked weight = the weighed value, else the estimate
--   per 100 g     = whole batch × 100 ÷ cooked weight (whole kcal, 1 dp)
-- and refuses a different estimate or per-100 g. Unknown fibre/sugar/salt stay NULL.
-- ---------------------------------------------------------------------------

create or replace function public.save_batch(
  p_id uuid,
  p_name text,
  p_cooked_weight_g numeric,
  p_weighed boolean,
  p_per_100g jsonb,
  p_ingredients jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_item jsonb;
  v_pos integer := 0;
  v_food public.foods%rowtype;
  v_food_id uuid;
  v_grams numeric;
  v_cooks_as text;
  v_ratio numeric;
  v_kcal integer := 0;
  v_protein numeric := 0;
  v_carbs numeric := 0;
  v_fat numeric := 0;
  v_raw numeric := 0;
  v_estimate numeric;
  v_cooked numeric;
  v_p_kcal integer;
  v_p_protein numeric;
  v_p_carbs numeric;
  v_p_fat numeric;
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'sign in to save batches' using errcode = '42501';
  end if;
  if not public.has_active_consent('health_data') then
    raise exception 'health data is off' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'give the batch a name' using errcode = '22023';
  end if;
  if p_ingredients is null or jsonb_typeof(p_ingredients) <> 'array'
     or jsonb_array_length(p_ingredients) = 0 then
    raise exception 'a batch needs at least one ingredient' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ingredients) > 50 then
    raise exception 'a batch can have at most 50 ingredients' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_ingredients)
  loop
    begin
      v_food_id := (v_item ->> 'food_id')::uuid;
      v_grams := round((v_item ->> 'grams')::numeric, 1);
      v_cooks_as := coalesce(v_item ->> 'cooks_as', 'as_added');
      v_ratio := round(coalesce((v_item ->> 'cooked_ratio')::numeric, 1), 2);
    exception when others then
      raise exception 'ingredient % is malformed', v_pos + 1 using errcode = '22023';
    end;
    if v_food_id is null or v_grams is null or v_grams <= 0 or v_grams > 5000 then
      raise exception 'ingredient % needs a food and 0.1–5000 g', v_pos + 1 using errcode = '22023';
    end if;
    if v_cooks_as !~ '^[a-z_]{1,32}$' or v_ratio <= 0 or v_ratio > 5
       or (v_cooks_as = 'as_added' and v_ratio <> 1) then
      raise exception 'ingredient %: unknown cooked-weight ratio', v_pos + 1 using errcode = '22023';
    end if;

    -- RLS on foods: only the global cache and the caller's own foods are visible.
    select * into v_food from public.foods where id = v_food_id;
    if not found then
      raise exception 'ingredient %: unknown food', v_pos + 1 using errcode = '22023';
    end if;
    if v_food.is_batch then
      raise exception 'ingredient %: a batch can''t go in another batch', v_pos + 1
        using errcode = '22023';
    end if;
    if v_food.kcal_per_100g is null or v_food.protein_per_100g is null
       or v_food.carbs_per_100g is null or v_food.fat_per_100g is null then
      raise exception 'ingredient %: % is missing nutrition values', v_pos + 1,
        coalesce(v_food.name, 'this food') using errcode = '22023';
    end if;

    -- Same maths as @life-os/core portionMacros, then summed like a meal.
    v_kcal := v_kcal + round(v_food.kcal_per_100g * v_grams / 100, 0)::integer;
    v_protein := v_protein + round(v_food.protein_per_100g * v_grams / 100, 1);
    v_carbs := v_carbs + round(v_food.carbs_per_100g * v_grams / 100, 1);
    v_fat := v_fat + round(v_food.fat_per_100g * v_grams / 100, 1);
    v_raw := v_raw + v_grams * v_ratio;

    v_rows := v_rows || jsonb_build_object(
      'food_id', v_food.id, 'grams', v_grams, 'cooks_as', v_cooks_as,
      'cooked_ratio', v_ratio, 'position', v_pos);
    v_pos := v_pos + 1;
  end loop;

  -- Same as core roundCookedWeight.
  v_raw := round(v_raw, 2);
  v_estimate := case
    when v_raw <= 0 then 0
    when v_raw < 100 then greatest(1, round(v_raw, 0))
    else round(v_raw / 10, 0) * 10
  end;

  if coalesce(p_weighed, false) then
    v_cooked := round(p_cooked_weight_g, 1);
    if v_cooked is null then
      raise exception 'enter the weight of the whole pot' using errcode = '22023';
    end if;
  else
    v_cooked := v_estimate;
    if p_cooked_weight_g is null or round(p_cooked_weight_g, 1) <> v_estimate then
      raise exception 'the cooked-weight estimate has changed; refresh and try again'
        using errcode = '22023';
    end if;
  end if;
  if v_cooked <= 0 or v_cooked > 50000 then
    raise exception 'the cooked weight must be between 1 g and 50 kg' using errcode = '22023';
  end if;
  if v_cooked < v_protein + v_carbs + v_fat then
    raise exception 'the cooked weight is less than the protein, carbs and fat that went in'
      using errcode = '22023';
  end if;

  v_p_kcal := round(v_kcal * 100 / v_cooked, 0)::integer;
  v_p_protein := round(v_protein * 100 / v_cooked, 1);
  v_p_carbs := round(v_carbs * 100 / v_cooked, 1);
  v_p_fat := round(v_fat * 100 / v_cooked, 1);

  begin
    if p_per_100g is null
       or (p_per_100g ->> 'kcal')::numeric is distinct from v_p_kcal
       or (p_per_100g ->> 'protein')::numeric is distinct from v_p_protein
       or (p_per_100g ->> 'carbs')::numeric is distinct from v_p_carbs
       or (p_per_100g ->> 'fat')::numeric is distinct from v_p_fat then
      raise exception using errcode = 'LO001';
    end if;
  exception when others then
    raise exception 'nutrition for this batch has changed; refresh and try again'
      using errcode = '22023';
  end;

  perform set_config('lifeos.save_batch', 'on', true);

  if p_id is null then
    insert into public.foods (
      user_id, source, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
      is_batch, cooked_weight_g, cooked_weight_weighed, cooked_at, remembered
    )
    values (
      auth.uid(), 'user', v_name, v_p_kcal, v_p_protein, v_p_carbs, v_p_fat,
      true, v_cooked, coalesce(p_weighed, false), now(), true
    )
    returning id into v_id;
  else
    update public.foods
      set name = v_name,
          kcal_per_100g = v_p_kcal,
          protein_per_100g = v_p_protein,
          carbs_per_100g = v_p_carbs,
          fat_per_100g = v_p_fat,
          cooked_weight_g = v_cooked,
          cooked_weight_weighed = coalesce(p_weighed, false),
          cooked_at = now()
      where id = p_id and is_batch and user_id = auth.uid()
      returning id into v_id;
    if v_id is null then
      perform set_config('lifeos.save_batch', 'off', true);
      raise exception 'batch not found' using errcode = 'P0002';
    end if;
    delete from public.batch_ingredients where batch_id = v_id;
  end if;

  -- RLS (with check) enforces consent and can_use_food for each ingredient.
  insert into public.batch_ingredients (batch_id, food_id, grams, cooks_as, cooked_ratio, position)
  select v_id, (r ->> 'food_id')::uuid, (r ->> 'grams')::numeric, r ->> 'cooks_as',
         (r ->> 'cooked_ratio')::numeric, (r ->> 'position')::smallint
  from jsonb_array_elements(v_rows) as r;

  perform set_config('lifeos.save_batch', 'off', true);
  return v_id;
end;
$$;

revoke all on function public.save_batch(uuid, text, numeric, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.save_batch(uuid, text, numeric, boolean, jsonb, jsonb) to authenticated;
revoke all on function public.foods_batch_guard() from public, anon;
revoke all on function public.batch_ingredients_guard() from public, anon;
