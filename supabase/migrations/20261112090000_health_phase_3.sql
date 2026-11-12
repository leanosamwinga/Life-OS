-- Life OS — Phase 3 · Health (docs/PHASE3-SIGNOFF.md, project doc health-phase-3-decisions.md)
--
--   * user_settings: Health targets (Me → Health targets, 6B): weight target, sleep target, the
--     nutrition plan's name, training sessions per week and the split rotation (ordered day
--     names; a text[] column, since the rotation is always read and saved whole).
--   * supplements: an optional reminder time (local notification on the phone, 24-hour).
--   * supplement_logs: at most one log per supplement per Europe/London day ("taken today").
--     taken_on is generated from logged_at, so the client can't send a day that disagrees.
--   * training_days (health table): one row per trained London date, with the split day number
--     and a snapshot of its name. Marking a day twice is a no-op (unique + on conflict do
--     nothing); untraining deletes the row; rows are never updated; no future dates.
--   * health_daily (health table): daily values synced from Apple Health by the iPhone —
--     weight_kg, sleep_min (+ sleep start/end) and steps only. Upserted per (user, date, kind).
--     Web and Android read them; nothing else is ever stored from HealthKit.
--
-- Health tables follow the convention: owner only via auth.uid(), active health_data consent,
-- created_at/updated_at + trigger, nothing for anon.

-- ---------------------------------------------------------------------------
-- user_settings: Health targets
-- ---------------------------------------------------------------------------

-- Split day names: 1–40 characters each, no blanks, at most 14 days.
create or replace function public.valid_split_rotation(days text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(days), 0) <= 14
     and not exists (
       select 1 from unnest(days) as d(name)
        where d.name is null or char_length(btrim(d.name)) not between 1 and 40
     );
$$;

alter table public.user_settings
  add column target_weight_kg numeric(5, 1) check (target_weight_kg between 20 and 400),
  add column target_sleep_min integer check (target_sleep_min between 60 and 1440),
  add column nutrition_plan_name text check (char_length(nutrition_plan_name) between 1 and 40),
  add column training_per_week smallint not null default 4 check (training_per_week between 0 and 14),
  add column training_split text[] not null default '{}'
    constraint user_settings_training_split_valid check (public.valid_split_rotation(training_split));

comment on column public.user_settings.training_split is
  'Split rotation, in order (Day 1 first). training_days snapshots the name used each day.';

-- ---------------------------------------------------------------------------
-- supplements: reminder time; supplement_logs: one per London day
-- ---------------------------------------------------------------------------

alter table public.supplements add column reminder_time time;
comment on column public.supplements.reminder_time is
  'Local notification time (Europe/London wall clock); null = no reminder.';

alter table public.supplement_logs
  add column taken_on date generated always as ((logged_at at time zone 'Europe/London')::date) stored;

-- Logs written before this rule (none in the app yet): keep the earliest per supplement and day.
delete from public.supplement_logs l
 using public.supplement_logs k
 where l.supplement_id = k.supplement_id
   and l.taken_on = k.taken_on
   and (l.logged_at, l.id) > (k.logged_at, k.id);

alter table public.supplement_logs
  add constraint supplement_logs_one_per_day unique (supplement_id, taken_on);

-- ---------------------------------------------------------------------------
-- training_days
-- ---------------------------------------------------------------------------

create table public.training_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trained_on date not null,
  -- Position in the rotation (1 = Day 1) and its name at the time; null when no split is set.
  split_day smallint check (split_day between 1 and 14),
  split_name text check (char_length(split_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_days_one_per_day unique (user_id, trained_on),
  constraint training_days_split_pair check ((split_day is null) = (split_name is null))
);

comment on table public.training_days is
  'Manual training log (Phase 3): one row per trained Europe/London date. Sets and reps stay in Liftoff.';

-- No future days (London calendar).
create or replace function public.training_days_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trained_on > (now() at time zone 'Europe/London')::date then
    raise exception 'training can''t be marked for a day that hasn''t happened yet'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger training_days_guard
  before insert on public.training_days
  for each row execute function public.training_days_guard();

-- ---------------------------------------------------------------------------
-- health_daily: synced Apple Health values
-- ---------------------------------------------------------------------------

create table public.health_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('weight_kg', 'sleep_min', 'steps')),
  value numeric(8, 1) not null,
  -- Sleep only: when the night's sleep started and ended.
  sleep_start timestamptz,
  sleep_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_daily_one_per_kind unique (user_id, day, kind),
  constraint health_daily_value_range check (
    (kind = 'weight_kg' and value between 20 and 400)
    or (kind = 'sleep_min' and value between 0 and 1440 and value = trunc(value))
    or (kind = 'steps' and value between 0 and 200000 and value = trunc(value))
  ),
  constraint health_daily_sleep_times check (
    case when kind = 'sleep_min'
      then sleep_start is not null and sleep_end is not null and sleep_end > sleep_start
      else sleep_start is null and sleep_end is null
    end
  )
);

comment on table public.health_daily is
  'Daily Apple Health values synced by the iPhone (weight_kg, sleep_min with start/end, steps). Nothing else from HealthKit is stored.';

create index health_daily_user_day_idx on public.health_daily (user_id, day);
create index training_days_user_day_idx on public.training_days (user_id, trained_on);

-- ---------------------------------------------------------------------------
-- updated_at, privileges, RLS
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.training_days
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.health_daily
  for each row execute function public.set_updated_at();

revoke all on public.training_days, public.health_daily from anon;
revoke all on function public.valid_split_rotation(text[]) from public, anon;
revoke all on function public.training_days_guard() from public, anon;
grant execute on function public.valid_split_rotation(text[]) to authenticated, service_role;
-- Training days are marked (insert) and unmarked (delete), never changed. Supabase's default
-- privileges grant update to authenticated on new tables, so take it back explicitly.
revoke update, truncate on public.training_days from authenticated;
grant select, insert, delete on public.training_days to authenticated;
grant select, insert, update, delete on public.health_daily to authenticated;
grant all on public.training_days, public.health_daily to service_role;

alter table public.training_days enable row level security;
alter table public.health_daily enable row level security;

create policy "training_days: owner with health consent" on public.training_days
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));

create policy "health_daily: owner with health consent" on public.health_daily
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')))
  with check (user_id = (select auth.uid()) and (select public.has_active_consent('health_data')));
