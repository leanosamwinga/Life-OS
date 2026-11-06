-- Life OS — Foundations schema
--
-- Conventions
--   * Every user table has RLS on, with owner-only policies via auth.uid().
--   * Nutrition is stored per 100 g. Logged meals snapshot their macros.
--   * Health data (nutrition logs, water, supplements, plan meals) is only readable or writable
--     while the user has an active 'health_data' consent (Privacy Policy §3, UK GDPR Art. 9(2)(a)).
--   * Global Open Food Facts cache rows have user_id NULL: readable by signed-in users,
--     writable only by the service role (which bypasses RLS).
--   * Money, calendar, church, workouts and check-ins arrive in later phases.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per user. Created automatically on sign-up.';

-- ---------------------------------------------------------------------------
-- user_settings: daily targets + nudge settings
-- ---------------------------------------------------------------------------

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Daily targets (null until the user sets them)
  target_kcal integer check (target_kcal between 0 and 20000),
  target_protein_g numeric(6, 1) check (target_protein_g >= 0),
  target_carbs_g numeric(6, 1) check (target_carbs_g >= 0),
  target_fat_g numeric(6, 1) check (target_fat_g >= 0),
  target_water_ml integer check (target_water_ml between 0 and 20000),
  target_steps integer check (target_steps between 0 and 200000),

  time_zone text not null default 'Europe/London',

  -- Nudges: quiet by default, individually toggleable
  morning_briefing_enabled boolean not null default true,
  morning_briefing_weekday_time time not null default '07:30',
  morning_briefing_weekend_time time not null default '08:30',
  evening_checkin_enabled boolean not null default true,
  evening_checkin_time time not null default '21:30',
  event_reminders_enabled boolean not null default false,
  urgent_bill_alerts_enabled boolean not null default true,
  statement_import_reminder_enabled boolean not null default true,
  statement_import_day smallint not null default 1 check (statement_import_day between 1 and 28),
  statement_import_time time not null default '09:00',
  quiet_hours_start time not null default '22:30',
  quiet_hours_end time not null default '07:00',

  -- Privacy
  app_lock_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- consents: explicit, auditable, withdrawable
-- ---------------------------------------------------------------------------

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('health_data', 'product_emails', 'terms', 'privacy_policy')),
  -- Version of the policy text the user agreed to, e.g. '2026-11-06'.
  policy_version text,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consents_withdrawn_after_granted check (withdrawn_at is null or withdrawn_at >= granted_at)
);

-- At most one active consent of each type per user.
create unique index consents_one_active_per_type
  on public.consents (user_id, type)
  where withdrawn_at is null;

-- Consent rows are an audit trail: once written, only withdrawn_at may change, and only once.
create or replace function public.consents_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.type is distinct from old.type
     or new.policy_version is distinct from old.policy_version
     or new.granted_at is distinct from old.granted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'consents are append-only: only withdrawn_at can be set';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'consent already withdrawn; grant a new consent instead';
  end if;
  return new;
end;
$$;

create trigger consents_guard_update
  before update on public.consents
  for each row execute function public.consents_guard_update();

-- True when the current user has an active consent of the given type.
-- SECURITY DEFINER so it can be used cheaply inside other tables' RLS policies.
create or replace function public.has_active_consent(consent_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.consents c
    where c.user_id = auth.uid()
      and c.type = consent_type
      and c.withdrawn_at is null
  );
$$;

revoke all on function public.has_active_consent(text) from public;
grant execute on function public.has_active_consent(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- foods: global Open Food Facts cache (user_id null) + user-created foods
-- ---------------------------------------------------------------------------

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  source text not null check (source in ('open_food_facts', 'user')),
  barcode text check (barcode ~ '^[0-9]{6,14}$'),
  name text check (char_length(name) <= 200),
  brand text check (char_length(brand) <= 200),
  -- Nutrition per 100 g. NULL means unknown — never invented.
  kcal_per_100g numeric(7, 2) check (kcal_per_100g >= 0),
  protein_per_100g numeric(6, 2) check (protein_per_100g >= 0),
  carbs_per_100g numeric(6, 2) check (carbs_per_100g >= 0),
  fat_per_100g numeric(6, 2) check (fat_per_100g >= 0),
  fibre_per_100g numeric(6, 2) check (fibre_per_100g >= 0),
  sugar_per_100g numeric(6, 2) check (sugar_per_100g >= 0),
  salt_per_100g numeric(6, 2) check (salt_per_100g >= 0),
  off_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Global cache rows come from Open Food Facts; user rows are the user's own.
  constraint foods_owner_matches_source check ((user_id is null) = (source = 'open_food_facts')),
  constraint foods_global_has_barcode check (user_id is not null or barcode is not null)
);

create unique index foods_global_barcode_key on public.foods (barcode) where user_id is null;
create index foods_barcode_idx on public.foods (barcode);
create index foods_user_id_idx on public.foods (user_id) where user_id is not null;

-- Lets child tables enforce that a referenced food is global or the caller's own.
create or replace function public.can_use_food(food uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.foods f
    where f.id = food and (f.user_id is null or f.user_id = auth.uid())
  );
$$;

revoke all on function public.can_use_food(uuid) from public;
grant execute on function public.can_use_food(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- food_portions_last: the amount the user had last time, for suggestions
-- ---------------------------------------------------------------------------

create table public.food_portions_last (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_id uuid not null references public.foods (id) on delete cascade,
  grams numeric(7, 1) not null check (grams > 0),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, food_id)
);

create index food_portions_last_user_logged_idx on public.food_portions_last (user_id, logged_at desc);

-- ---------------------------------------------------------------------------
-- saved_meals (the roster) + components. Plan meals are saved meals in the daily plan.
-- ---------------------------------------------------------------------------

create table public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  in_daily_plan boolean not null default false,
  usual_time time,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index saved_meals_user_idx on public.saved_meals (user_id, sort_order);

create table public.saved_meal_components (
  id uuid primary key default gen_random_uuid(),
  saved_meal_id uuid not null,
  user_id uuid not null default auth.uid(),
  food_id uuid not null references public.foods (id),
  grams numeric(7, 1) not null check (grams > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FK guarantees a component belongs to a meal of the same user.
  foreign key (saved_meal_id, user_id) references public.saved_meals (id, user_id) on delete cascade
);

create index saved_meal_components_meal_idx on public.saved_meal_components (saved_meal_id, position);
create index saved_meal_components_food_idx on public.saved_meal_components (food_id);

-- ---------------------------------------------------------------------------
-- meal_logs + items (macros snapshotted at log time)
-- ---------------------------------------------------------------------------

create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  saved_meal_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- Only your own roster meals; deleting the saved meal keeps the log.
  foreign key (saved_meal_id, user_id) references public.saved_meals (id, user_id)
    on delete set null (saved_meal_id)
);

create index meal_logs_user_logged_idx on public.meal_logs (user_id, logged_at);

create table public.meal_log_items (
  id uuid primary key default gen_random_uuid(),
  meal_log_id uuid not null,
  user_id uuid not null default auth.uid(),
  -- Kept for "last time" suggestions; history survives if the food is deleted.
  food_id uuid references public.foods (id) on delete set null,
  food_name text not null check (char_length(food_name) between 1 and 200),
  grams numeric(7, 1) not null check (grams > 0),
  kcal integer not null check (kcal >= 0),
  protein_g numeric(6, 1) not null check (protein_g >= 0),
  carbs_g numeric(6, 1) not null check (carbs_g >= 0),
  fat_g numeric(6, 1) not null check (fat_g >= 0),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (meal_log_id, user_id) references public.meal_logs (id, user_id) on delete cascade
);

create index meal_log_items_log_idx on public.meal_log_items (meal_log_id, position);
create index meal_log_items_food_idx on public.meal_log_items (food_id);

-- ---------------------------------------------------------------------------
-- water_logs
-- ---------------------------------------------------------------------------

create table public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ml integer not null check (ml > 0 and ml <= 5000),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index water_logs_user_logged_idx on public.water_logs (user_id, logged_at);

-- ---------------------------------------------------------------------------
-- supplements + supplement_logs
-- ---------------------------------------------------------------------------

create table public.supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  dose text check (char_length(dose) <= 40),
  time_of_day text not null default 'any' check (time_of_day in ('morning', 'evening', 'any')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index supplements_user_idx on public.supplements (user_id, sort_order);

create table public.supplement_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  supplement_id uuid not null,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (supplement_id, user_id) references public.supplements (id, user_id) on delete cascade
);

create index supplement_logs_user_logged_idx on public.supplement_logs (user_id, logged_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'consents', 'foods', 'food_portions_last', 'saved_meals',
    'saved_meal_components', 'meal_logs', 'meal_log_items', 'water_logs', 'supplements',
    'supplement_logs'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + default settings
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; signed-in users go through RLS.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Profiles and settings are created by the trigger and removed with the account.
revoke insert, delete on public.profiles, public.user_settings from authenticated;
-- Consents are an audit trail: no deletes (they go with the account).
revoke delete on public.consents from authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.consents enable row level security;
alter table public.foods enable row level security;
alter table public.food_portions_last enable row level security;
alter table public.saved_meals enable row level security;
alter table public.saved_meal_components enable row level security;
alter table public.meal_logs enable row level security;
alter table public.meal_log_items enable row level security;
alter table public.water_logs enable row level security;
alter table public.supplements enable row level security;
alter table public.supplement_logs enable row level security;

-- profiles / user_settings: read and update your own row.
create policy "profiles: owner can read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: owner can update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "user_settings: owner can read" on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_settings: owner can update" on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- consents: read, grant and withdraw your own.
create policy "consents: owner can read" on public.consents
  for select to authenticated using (user_id = (select auth.uid()));
create policy "consents: owner can grant" on public.consents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "consents: owner can withdraw" on public.consents
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- foods: everyone signed in reads the global cache; users manage only their own foods.
create policy "foods: read global cache and own foods" on public.foods
  for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy "foods: owner can insert" on public.foods
  for insert to authenticated with check (user_id = (select auth.uid()) and source = 'user');
create policy "foods: owner can update" on public.foods
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and source = 'user');
create policy "foods: owner can delete" on public.foods
  for delete to authenticated using (user_id = (select auth.uid()));

-- Health tables: owner only, and only while health-data consent is active.
create policy "food_portions_last: owner with health consent" on public.food_portions_last
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (
    user_id = (select auth.uid())
    and (select public.has_active_consent('health_data'))
    and public.can_use_food(food_id)
  );

create policy "saved_meals: owner with health consent" on public.saved_meals
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));

create policy "saved_meal_components: owner with health consent" on public.saved_meal_components
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (
    user_id = (select auth.uid())
    and (select public.has_active_consent('health_data'))
    and public.can_use_food(food_id)
  );

create policy "meal_logs: owner with health consent" on public.meal_logs
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));

create policy "meal_log_items: owner with health consent" on public.meal_log_items
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (
    user_id = (select auth.uid())
    and (select public.has_active_consent('health_data'))
    and (food_id is null or public.can_use_food(food_id))
  );

create policy "water_logs: owner with health consent" on public.water_logs
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));

create policy "supplements: owner with health consent" on public.supplements
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));

create policy "supplement_logs: owner with health consent" on public.supplement_logs
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));
