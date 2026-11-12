-- Phase 3 · Health: Health targets on user_settings, supplement reminder times, one supplement log
-- per London day, training_days (one per day, no-op twice, delete to untrain, no updates, no
-- future days) and health_daily (Apple Health values: three kinds only, upsert per day). Both new
-- tables are owner only and need an active health_data consent; anon gets nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

insert into auth.users (id, email) values
  ('a1a1a1a1-0000-0000-0000-0000000000e1', 'health-a@example.test'),
  ('b2b2b2b2-0000-0000-0000-0000000000e2', 'health-b@example.test');
insert into public.consents (user_id, type, policy_version) values
  ('a1a1a1a1-0000-0000-0000-0000000000e1', 'health_data', '2026-11-06'),
  ('b2b2b2b2-0000-0000-0000-0000000000e2', 'health_data', '2026-11-06');

create temp table london as select
  (now() at time zone 'Europe/London')::date as today,
  ((now() at time zone 'Europe/London')::date + 1) as tomorrow;
grant select on london to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_column('public', 'user_settings', 'target_weight_kg', 'weight target');
select has_column('public', 'user_settings', 'target_sleep_min', 'sleep target');
select has_column('public', 'user_settings', 'training_split', 'split rotation');
select has_column('public', 'supplements', 'reminder_time', 'supplement reminder time');
select has_table('public', 'training_days', 'training_days exists');
select has_table('public', 'health_daily', 'health_daily exists');
select ok((select relrowsecurity from pg_class where oid = 'public.training_days'::regclass), 'RLS on training_days');
select ok((select relrowsecurity from pg_class where oid = 'public.health_daily'::regclass), 'RLS on health_daily');
select ok(not has_table_privilege('anon', 'public.training_days', 'select'), 'anon can''t read training_days');
select ok(not has_table_privilege('anon', 'public.health_daily', 'select'), 'anon can''t read health_daily');
select ok(not has_table_privilege('authenticated', 'public.training_days', 'update'), 'training days are never updated');
select is((select training_per_week from public.user_settings where user_id = 'a1a1a1a1-0000-0000-0000-0000000000e1'), 4::smallint,
  'training target defaults to 4 a week');
select is((select training_split from public.user_settings where user_id = 'a1a1a1a1-0000-0000-0000-0000000000e1'), '{}'::text[],
  'no split until the user sets one');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Health targets
-- ---------------------------------------------------------------------------
select lives_ok($$update public.user_settings set target_weight_kg = 80.0, target_sleep_min = 450,
  nutrition_plan_name = 'Plan A', training_per_week = 4,
  training_split = array['Arms & shoulders', 'Chest & triceps', 'Legs', 'Back']$$, 'targets save');
select is((select target_sleep_min from public.user_settings), 450, '7h 30m a night');
select throws_ok($$update public.user_settings set target_weight_kg = 5$$, '23514', null, 'weight target out of range');
select throws_ok($$update public.user_settings set training_split = array['Legs', '  ']$$, '23514', null, 'blank split day refused');
select throws_ok($$update public.user_settings set training_per_week = 15$$, '23514', null, 'at most 14 a week');

-- ---------------------------------------------------------------------------
-- Supplements: reminder time, one log per London day
-- ---------------------------------------------------------------------------
create temp table supp (id uuid);
grant select, insert on supp to authenticated;
with s as (insert into public.supplements (name, dose, time_of_day, reminder_time)
           values ('Creatine', '5 g', 'morning', '08:00') returning id)
insert into supp select id from s;
select is((select reminder_time from public.supplements where id = (select id from supp)), '08:00'::time, 'reminder time saved');

insert into public.supplement_logs (supplement_id) values ((select id from supp));
select is((select taken_on from public.supplement_logs), (select today from london), 'taken_on is the London day');
select throws_ok($$insert into public.supplement_logs (supplement_id) values ((select id from supp))$$,
  '23505', null, 'a second log on the same London day is refused');
select lives_ok($$insert into public.supplement_logs (supplement_id) values ((select id from supp))
  on conflict (supplement_id, taken_on) do nothing$$, 'ticking again is a no-op with on conflict');
select is((select count(*)::int from public.supplement_logs), 1, 'still one log today');
select lives_ok($$insert into public.supplement_logs (supplement_id, logged_at) values ((select id from supp), now() - interval '1 day')$$,
  'yesterday is its own day');
select throws_ok($$insert into public.supplement_logs (supplement_id, taken_on) values ((select id from supp), '2026-01-01')$$,
  '428C9', null, 'taken_on can''t be sent by the client');
-- Midnight boundary in BST: 23:30 UTC on 1 Jul is 00:30 on 2 Jul in London.
insert into public.supplement_logs (supplement_id, logged_at) values ((select id from supp), '2026-07-01T23:30:00Z');
select is((select taken_on from public.supplement_logs where logged_at = '2026-07-01T23:30:00Z'), '2026-07-02'::date,
  'after midnight London time counts towards the next day (BST)');
delete from public.supplement_logs where taken_on = (select today from london);
select is((select count(*)::int from public.supplement_logs where taken_on = (select today from london)), 0, 'unticking deletes today''s log');

-- ---------------------------------------------------------------------------
-- training_days
-- ---------------------------------------------------------------------------
select lives_ok($$insert into public.training_days (trained_on, split_day, split_name)
  values ((select today from london) - 1, 3, 'Legs')$$, 'mark yesterday trained');
select is((select split_name from public.training_days), 'Legs', 'the split name is a snapshot');
select lives_ok($$insert into public.training_days (trained_on, split_day, split_name)
  values ((select today from london) - 1, 1, 'Arms & shoulders') on conflict (user_id, trained_on) do nothing$$,
  'marking the same day again is a no-op');
select is((select split_day::int || ' ' || split_name from public.training_days), '3 Legs', 'the first mark stands');
select throws_ok($$insert into public.training_days (trained_on) values ((select today from london) - 1)$$,
  '23505', null, 'one row per day');
select throws_ok($$insert into public.training_days (trained_on) values ((select tomorrow from london))$$,
  '22023', null, 'no future days');
select throws_ok($$insert into public.training_days (trained_on, split_day) values ((select today from london), 2)$$,
  '23514', null, 'a split day needs its name');
select lives_ok($$insert into public.training_days (trained_on) values ((select today from london))$$,
  'a day can be trained without a split');
select throws_ok($$update public.training_days set split_name = 'Back'$$, '42501', null, 'rows can''t be changed');
delete from public.training_days where trained_on = (select today from london);
select is((select count(*)::int from public.training_days), 1, 'untraining deletes the row');

-- ---------------------------------------------------------------------------
-- health_daily
-- ---------------------------------------------------------------------------
select lives_ok($$insert into public.health_daily (day, kind, value) values ((select today from london), 'steps', 6240),
  ((select today from london), 'weight_kg', 82.4)$$, 'steps and weight sync');
select lives_ok($$insert into public.health_daily (day, kind, value, sleep_start, sleep_end)
  values ((select today from london), 'sleep_min', 432, now() - interval '9 hours', now() - interval '2 hours')$$, 'sleep syncs with start and end');
select lives_ok($$insert into public.health_daily (day, kind, value) values ((select today from london), 'steps', 7100)
  on conflict (user_id, day, kind) do update set value = excluded.value$$, 'a re-sync upserts');
select is((select value from public.health_daily where kind = 'steps'), 7100.0, 'the latest value wins');
select throws_ok($$insert into public.health_daily (day, kind, value) values ((select today from london) - 1, 'heart_rate', 60)$$,
  '23514', null, 'only weight, sleep and steps are stored');
select throws_ok($$insert into public.health_daily (day, kind, value) values ((select today from london) - 1, 'sleep_min', 400)$$,
  '23514', null, 'sleep needs its start and end');
select throws_ok($$insert into public.health_daily (day, kind, value) values ((select today from london) - 1, 'steps', 12.5)$$,
  '23514', null, 'steps are whole numbers');

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select is_empty('select 1 from public.training_days', 'another user can''t see your training');
select is_empty('select 1 from public.health_daily', 'another user can''t see your Apple Health values');
select is_empty('select 1 from public.supplement_logs', 'or your supplement logs');
delete from public.training_days;
update public.health_daily set value = 1;
select throws_ok($$insert into public.training_days (user_id, trained_on) values ('a1a1a1a1-0000-0000-0000-0000000000e1', (select today from london))$$,
  '42501', null, 'can''t mark training for someone else');
select throws_ok($$insert into public.health_daily (user_id, day, kind, value) values ('a1a1a1a1-0000-0000-0000-0000000000e1', (select today from london), 'steps', 1)$$,
  '42501', null, 'can''t sync values for someone else');
select throws_ok($$insert into public.supplement_logs (user_id, supplement_id) values ('b2b2b2b2-0000-0000-0000-0000000000e2', (select id from supp))$$,
  '23503', null, 'can''t log someone else''s supplement (composite FK)');
reset role;
select is((select count(*)::int from public.training_days where user_id = 'a1a1a1a1-0000-0000-0000-0000000000e1'), 1,
  'the other user deleted nothing');
select is((select value from public.health_daily where user_id = 'a1a1a1a1-0000-0000-0000-0000000000e1' and kind = 'steps'), 7100.0,
  'and changed nothing');

-- ---------------------------------------------------------------------------
-- Consent gate
-- ---------------------------------------------------------------------------
update public.consents set withdrawn_at = now() where user_id = 'a1a1a1a1-0000-0000-0000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is_empty('select 1 from public.health_daily', 'without consent synced values are hidden');
select throws_ok($$insert into public.health_daily (day, kind, value) values ((select today from london) - 2, 'steps', 100)$$,
  '42501', null, 'and nothing syncs');
select throws_ok($$insert into public.training_days (trained_on) values ((select today from london) - 2)$$,
  '42501', null, 'no training marks without consent');

select * from finish();
rollback;
