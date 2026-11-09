-- Log meal and water follow-ups: replace_logged_meal ("Log a corrected copy") logs a new meal and
-- deletes the old one atomically, keeps the plan link, refuses mismatched macros, and needs the
-- owner, an active health_data consent and both times inside the window. Water: delete your own
-- entries only, with consent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('a1a1a1a1-0000-0000-0000-0000000000d1', 'follow-a@example.test'),
  ('b2b2b2b2-0000-0000-0000-0000000000d2', 'follow-b@example.test');

insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) values
  ('fd000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000000971', 'Test oats', 389, 13.5, 66.0, 6.9),
  ('fd000000-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-0000000000d1', 'user', null, 'Sample berries', 45, 0.8, 9.0, 0.3);

insert into public.consents (user_id, type, policy_version) values
  ('a1a1a1a1-0000-0000-0000-0000000000d1', 'health_data', '2026-11-06'),
  ('b2b2b2b2-0000-0000-0000-0000000000d2', 'health_data', '2026-11-06');

select has_function('public', 'replace_logged_meal', array['uuid', 'text', 'timestamp with time zone', 'jsonb'],
  'replace_logged_meal exists');
select ok(not (select prosecdef from pg_proc where proname = 'replace_logged_meal'), 'replace_logged_meal is SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'public.replace_logged_meal(uuid, text, timestamptz, jsonb)', 'execute'),
  'anon cannot replace meals');
select ok(has_function_privilege('authenticated', 'public.replace_logged_meal(uuid, text, timestamptz, jsonb)', 'execute'),
  'signed-in users can');

-- A meal from three days ago (history: outside the window).
insert into public.meal_logs (id, user_id, name, logged_at) values
  ('fe000000-0000-0000-0000-0000000000a1', 'a1a1a1a1-0000-0000-0000-0000000000d1', 'Old oats', now() - interval '3 days');

create temp table times as select
  ((now() at time zone 'Europe/London')::date - 1 + time '21:15') at time zone 'Europe/London' as yesterday_2115;
grant select on times to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

create temp table plan_meal as select public.save_meal(null, 'Breakfast · Test oats', true, '08:00', '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":60}
]'::jsonb) as id;
grant select on plan_meal to authenticated;
create temp table old_log as select public.log_meal('Breakfast · Test oats', (select id from plan_meal), now() - interval '10 minutes', '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb) as id;
grant select on old_log to authenticated;

-- ---------------------------------------------------------------------------
-- Refusals leave the original untouched
-- ---------------------------------------------------------------------------
select throws_ok($$select public.replace_logged_meal((select id from old_log), 'Corrected', now(), '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":80,"kcal":999,"protein":10.8,"carbs":52.8,"fat":5.5}
]'::jsonb)$$, '22023', null, 'mismatched macros are refused, as in log_meal');
select throws_ok($$select public.replace_logged_meal((select id from old_log), 'Corrected', now() + interval '2 hours', '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":80,"kcal":311,"protein":10.8,"carbs":52.8,"fat":5.5}
]'::jsonb)$$, '22023', 'pick a time no more than an hour from now', 'the new time must be inside the window');
select throws_ok($$select public.replace_logged_meal((select id from old_log), 'Corrected', now(), '[
  {"food_id":"fd000000-0000-0000-0000-0000000000ff","grams":80,"kcal":311,"protein":10.8,"carbs":52.8,"fat":5.5}
]'::jsonb)$$, '22023', null, 'a food that no longer exists is refused');
select throws_ok($$select public.replace_logged_meal((select id from old_log), 'Corrected', now(), '[]'::jsonb)$$,
  '22023', null, 'a corrected copy needs a component');
select throws_ok($$select public.replace_logged_meal('fe000000-0000-0000-0000-0000000000a1', 'Corrected', now(), '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":80,"kcal":311,"protein":10.8,"carbs":52.8,"fat":5.5}
]'::jsonb)$$, '22023', 'meals from before yesterday can''t be changed', 'the old meal must be inside the window');
select is((select count(*)::int from public.meal_logs where name = 'Corrected'), 0, 'refusals log nothing');
select is((select count(*)::int from public.meal_logs where id = (select id from old_log)), 1, 'refusals keep the original');
select is((select grams || ' ' || kcal from public.meal_log_items where meal_log_id = (select id from old_log)), '60.0 233',
  'the original''s amounts are unchanged');

-- ---------------------------------------------------------------------------
-- Another user can't see or replace it
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select throws_ok($$select public.replace_logged_meal((select id from old_log), 'Taken over', now(), '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":80,"kcal":311,"protein":10.8,"carbs":52.8,"fat":5.5}
]'::jsonb)$$, 'P0002', 'meal not found', 'another user''s meal is not found');
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is((select name from public.meal_logs where id = (select id from old_log)), 'Breakfast · Test oats', 'still the owner''s, unchanged');
select is((select count(*)::int from public.meal_logs where name = 'Taken over'), 0, 'nothing logged for the other user');

-- ---------------------------------------------------------------------------
-- The corrected copy
-- ---------------------------------------------------------------------------
create temp table new_log as select public.replace_logged_meal((select id from old_log), '  Breakfast · Test oats  ', (select yesterday_2115 from times), '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":80,"kcal":311,"protein":10.8,"carbs":52.8,"fat":5.5},
  {"food_id":"fd000000-0000-0000-0000-000000000002","grams":100,"kcal":45,"protein":0.8,"carbs":9.0,"fat":0.3}
]'::jsonb) as id;
grant select on new_log to authenticated;
select isnt((select id from new_log), (select id from old_log), 'a new meal is logged');
select is((select count(*)::int from public.meal_logs where id = (select id from old_log)), 0, 'the old meal is deleted');
select is((select count(*)::int from public.meal_log_items where meal_log_id = (select id from old_log)), 0, 'with its items');
select is((select saved_meal_id from public.meal_logs where id = (select id from new_log)), (select id from plan_meal),
  'the plan link is kept, so the plan meal stays eaten');
select is((select name from public.meal_logs where id = (select id from new_log)), 'Breakfast · Test oats', 'name trimmed');
select is((select logged_at from public.meal_logs where id = (select id from new_log)), (select yesterday_2115 from times),
  'at the new time');
select is((select string_agg(grams || ' ' || kcal, ',' order by position) from public.meal_log_items where meal_log_id = (select id from new_log)),
  '80.0 311,100.0 45', 'the new amounts and recomputed macros');
select is((select grams::text from public.food_portions_last where food_id = 'fd000000-0000-0000-0000-000000000001'), '60.0',
  'as in log_meal, a back-dated copy doesn''t override a newer "last time"');
select is((select count(*)::int from public.saved_meal_components where saved_meal_id = (select id from plan_meal)), 1,
  'the plan meal itself is unchanged');

-- ---------------------------------------------------------------------------
-- Water: delete your own, with consent
-- ---------------------------------------------------------------------------
create temp table water_a (id uuid);
with w as (insert into public.water_logs (ml) values (330) returning id) insert into water_a select id from w;
insert into public.water_logs (ml) values (250);

select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select is((select count(*)::int from public.water_logs where id = (select id from water_a)), 0, 'another user can''t see your water');
delete from public.water_logs where id = (select id from water_a);
update public.water_logs set ml = 1 where id = (select id from water_a);
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is((select ml from public.water_logs where id = (select id from water_a)), 330, 'another user can''t delete or change it');

delete from public.water_logs where id = (select id from water_a);
select is((select count(*)::int from public.water_logs where id = (select id from water_a)), 0, 'you can delete your own water');
select is((select coalesce(sum(ml), 0)::int from public.water_logs), 250, 'the rest stays');
select throws_ok($$insert into public.water_logs (ml) values (5001)$$, '23514', null, 'more than 5,000 ml is refused');
select throws_ok($$insert into public.water_logs (ml) values (0)$$, '23514', null, '0 ml is refused');

-- ---------------------------------------------------------------------------
-- Consent off: nothing can be corrected, logged again or deleted
-- ---------------------------------------------------------------------------
reset role;
update public.consents set withdrawn_at = now() where user_id = 'a1a1a1a1-0000-0000-0000-0000000000d1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select throws_ok($$select public.replace_logged_meal((select id from new_log), 'No consent', now(), '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb)$$, '42501', null, 'no corrected copy without health consent');
select throws_ok($$select public.log_meal('No consent', null, now(), '[
  {"food_id":"fd000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb)$$, '42501', null, 'no "Log again" without health consent');
select throws_ok($$insert into public.water_logs (ml) values (150)$$, '42501', null, 'no water without health consent');
delete from public.water_logs;
reset role;
select is((select count(*)::int from public.water_logs where user_id = 'a1a1a1a1-0000-0000-0000-0000000000d1'), 1,
  'without consent your water can''t be deleted');
select is((select count(*)::int from public.meal_logs where id = (select id from new_log)), 1,
  'and the corrected meal is still there');

select * from finish();
rollback;
