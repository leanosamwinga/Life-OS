-- Phase 2B: log_meal is atomic, validates macros server-side, snapshots items, upserts the
-- last portion, and stays under RLS (SECURITY INVOKER). save_meal likewise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'log-a@example.test'),
  ('b2b2b2b2-0000-0000-0000-000000000002', 'log-b@example.test');

insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) values
  ('f0000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000000901', 'Test chicken', 106, 24.0, 0, 1.2),
  ('f0000000-0000-0000-0000-000000000002', null, 'open_food_facts', '0000000000902', 'Test rice', 130, 2.7, 28.0, 0.3),
  ('f0000000-0000-0000-0000-000000000003', null, 'open_food_facts', '0000000000903', 'Test incomplete', 120, null, 28.0, 0.5),
  ('f0000000-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'user', null, 'A''s noodles', 360, 6.0, 80.0, 1.0),
  ('f0000000-0000-0000-0000-00000000000b', 'b2b2b2b2-0000-0000-0000-000000000002', 'user', null, 'B''s secret', 100, 1, 1, 1);

insert into public.consents (user_id, type, policy_version) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'health_data', '2026-11-06');

select ok(not (select prosecdef from pg_proc where proname = 'log_meal'), 'log_meal is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where proname = 'save_meal'), 'save_meal is SECURITY INVOKER');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Happy path: 200 g chicken (212 kcal, P 48.0, C 0, F 2.4) + 150 g rice (195 kcal, P 4.1, C 42.0, F 0.5)
create temp table result as
select public.log_meal('Chicken rice', null, now() - interval '1 hour', $$[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":200,"kcal":212,"protein":48.0,"carbs":0,"fat":2.4},
  {"food_id":"f0000000-0000-0000-0000-000000000002","grams":150,"kcal":195,"protein":4.1,"carbs":42.0,"fat":0.5}
]$$::jsonb) as id;

select isnt((select id from result), null, 'log_meal returns the new log id');
select is((select count(*)::int from public.meal_logs), 1, 'one meal log');
select is((select count(*)::int from public.meal_log_items), 2, 'two snapshotted items');
select is((select sum(kcal)::int from public.meal_log_items), 407, 'kcal snapshotted');
select is((select food_name from public.meal_log_items where position = 1), 'Test rice', 'food name snapshotted');
select is((select grams from public.food_portions_last where food_id = 'f0000000-0000-0000-0000-000000000002'), 150.0, 'last portion recorded');

-- Rounding matches core (45 g chicken: 47.7 → 48 kcal, fat 0.54 → 0.5)
select lives_ok($$select public.log_meal('Rounding', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":45,"kcal":48,"protein":10.8,"carbs":0,"fat":0.5}
]'::jsonb)$$, 'server rounding matches core');

-- Mismatched macros are rejected and nothing is written (atomic)
select throws_ok($$select public.log_meal('Bad', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000002","grams":100,"kcal":130,"protein":2.7,"carbs":28,"fat":0.3},
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":100,"kcal":999,"protein":24,"carbs":0,"fat":1.2}
]'::jsonb)$$, '22023', null, 'tampered kcal rejected');
select throws_ok($$select public.log_meal('No macros', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":100}
]'::jsonb)$$, '22023', null, 'client macros are required');
select is((select count(*)::int from public.meal_logs), 2, 'failed logs leave no meal behind');
select is((select count(*)::int from public.meal_log_items), 3, 'failed logs leave no items behind');
select is((select grams from public.food_portions_last where food_id = 'f0000000-0000-0000-0000-000000000002'), 150.0, 'failed logs do not touch last portion');

-- Incomplete foods, other users' foods, empty meals, bad grams
select throws_ok($$select public.log_meal('Incomplete', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000003","grams":60,"kcal":72,"protein":0,"carbs":16.8,"fat":0.3}
]'::jsonb)$$, '22023', null, 'food with missing nutrition cannot be logged');
select throws_ok($$select public.log_meal('Steal', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-00000000000b","grams":100,"kcal":100,"protein":1,"carbs":1,"fat":1}
]'::jsonb)$$, '22023', null, 'another user''s food is invisible');
select throws_ok($$select public.log_meal('Empty', null, now(), '[]'::jsonb)$$, '22023', null, 'empty meal rejected');
select throws_ok($$select public.log_meal('Zero', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0}
]'::jsonb)$$, '22023', null, 'zero grams rejected');

-- Last portion: an older back-dated log doesn't overwrite, a newer one does
-- (back-dated within the window: yesterday 00:00 is always at least 24 hours ago)
select lives_ok($$select public.log_meal('Old', null, now() - interval '20 hours', '[
  {"food_id":"f0000000-0000-0000-0000-000000000002","grams":50,"kcal":65,"protein":1.4,"carbs":14,"fat":0.2}
]'::jsonb)$$, 'back-dated log works');
select is((select grams from public.food_portions_last where food_id = 'f0000000-0000-0000-0000-000000000002'), 150.0, 'older log keeps the newer last portion');
select lives_ok($$select public.log_meal('Own noodles', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-00000000000a","grams":70,"kcal":252,"protein":4.2,"carbs":56,"fat":0.7}
]'::jsonb)$$, 'own user food can be logged');

-- Snapshots survive food edits
update public.foods set kcal_per_100g = 500 where id = 'f0000000-0000-0000-0000-00000000000a';
select is((select kcal from public.meal_log_items where food_name = 'A''s noodles'), 252, 'editing a food does not rewrite history');

-- save_meal
create temp table meal as
select public.save_meal(null, 'Plan lunch', true, '12:30', '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":200},
  {"food_id":"f0000000-0000-0000-0000-000000000002","grams":200}
]'::jsonb) as id;
grant select on meal to authenticated;
select is((select count(*)::int from public.saved_meal_components), 2, 'saved meal with two components');
select lives_ok($$select public.save_meal((select id from meal), 'Plan lunch', true, '12:45', '[
  {"food_id":"f0000000-0000-0000-0000-000000000002","grams":180}
]'::jsonb)$$, 'saved meal updated');
select is((select count(*)::int || ' ' || min(grams)::text from public.saved_meal_components), '1 180.0', 'components replaced');
select throws_ok($$select public.save_meal(null, 'No time', true, null, '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":100}
]'::jsonb)$$, '23514', null, 'plan meals need a usual time');
select lives_ok($$select public.log_meal('Plan lunch', (select id from meal), now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000002","grams":180,"kcal":234,"protein":4.9,"carbs":50.4,"fat":0.5}
]'::jsonb)$$, 'log from a roster meal');

-- User B: no consent, can't use A's meal or see A's rows
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.log_meal('B lunch', null, now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":100,"kcal":106,"protein":24,"carbs":0,"fat":1.2}
]'::jsonb)$$, '42501', null, 'no logging without health consent');
reset role;
insert into public.consents (user_id, type, policy_version) values ('b2b2b2b2-0000-0000-0000-000000000002', 'health_data', '2026-11-06');
set local role authenticated;
select throws_ok($$select public.log_meal('Hijack', (select id from meal), now(), '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":100,"kcal":106,"protein":24,"carbs":0,"fat":1.2}
]'::jsonb)$$, '23503', null, 'cannot log against another user''s saved meal');
select throws_ok($$select public.save_meal((select id from meal), 'Mine now', false, null, '[
  {"food_id":"f0000000-0000-0000-0000-000000000001","grams":100}
]'::jsonb)$$, 'P0002', null, 'cannot edit another user''s saved meal');
select is((select count(*)::int from public.meal_logs) + (select count(*)::int from public.saved_meals) + (select count(*)::int from public.food_portions_last), 0, 'B sees none of A''s logs, meals or portions');

-- Deleting a saved meal keeps its logs
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-000000000001","role":"authenticated"}', true);
delete from public.saved_meals where id = (select id from meal);
select is((select count(*)::int from public.meal_logs where name = 'Plan lunch' and saved_meal_id is null), 1, 'deleting a saved meal keeps its log');

reset role;
select * from finish();
rollback;
