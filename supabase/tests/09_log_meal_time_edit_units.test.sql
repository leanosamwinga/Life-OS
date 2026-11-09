-- Log meal follow-up: a meal's time is from yesterday 00:00 to an hour from now (log_meal and
-- update_logged_meal); editing a logged meal changes only its name, time and units; amounts are
-- locked; deleting a plan meal's log brings the plan meal back; g or ml on foods and amounts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

insert into auth.users (id, email) values
  ('a1a1a1a1-0000-0000-0000-0000000000c1', 'time-a@example.test'),
  ('b2b2b2b2-0000-0000-0000-0000000000c2', 'time-b@example.test');

-- Wireframes: oats 60 g = 233 kcal; a 330 ml shake at 62 kcal per 100 ml = 205 kcal.
insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, nutrition_unit, pack_g) values
  ('fc000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000000961', 'Test oats', 389, 13.5, 66.0, 6.9, 'g', null),
  ('fc000000-0000-0000-0000-000000000002', null, 'open_food_facts', '0000000000962', 'Sample protein shake', 62, 6.1, 6.6, 1.2, 'ml', 330),
  ('fc000000-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-0000000000c1', 'user', null, 'Sample oat drink', 45, 1.0, 6.6, 1.5, 'ml', null);

insert into public.consents (user_id, type, policy_version) values
  ('a1a1a1a1-0000-0000-0000-0000000000c1', 'health_data', '2026-11-06'),
  ('b2b2b2b2-0000-0000-0000-0000000000c2', 'health_data', '2026-11-06');

select has_column('public', 'foods', 'nutrition_unit', 'foods say per 100 g or per 100 ml');
select has_column('public', 'meal_log_items', 'unit', 'logged amounts carry a unit');
select has_column('public', 'saved_meal_components', 'unit', 'saved amounts carry a unit');
select has_column('public', 'food_portions_last', 'unit', 'last time''s amount carries a unit');
select has_column('public', 'meal_logs', 'edited_at', 'edits are recorded internally');
select is((select nutrition_unit from public.foods where barcode = '0000000000961'), 'g', 'foods default to g');
select ok(not (select prosecdef from pg_proc where proname = 'update_logged_meal'), 'update_logged_meal is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where proname = 'delete_logged_meal'), 'delete_logged_meal is SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'public.delete_logged_meal(uuid)', 'execute'), 'anon cannot delete meals');
select ok(not has_function_privilege('anon', 'public.update_logged_meal(uuid, text, timestamptz, jsonb)', 'execute'), 'anon cannot edit meals');
select ok(exists (select 1 from pg_constraint where conname = 'foods_batch_unit_g'), 'batches are always per 100 g');
select throws_ok($$insert into public.foods (source, barcode, name, nutrition_unit) values ('open_food_facts', '0000000000969', 'Bad', 'oz')$$,
  '23514', null, 'a nutrition unit is g or ml');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- The window: yesterday 00:00 (London) up to an hour from now
-- ---------------------------------------------------------------------------
create temp table times as select
  ((now() at time zone 'Europe/London')::date - 1)::timestamp at time zone 'Europe/London' as yesterday_start,
  ((now() at time zone 'Europe/London')::date - 1 + time '21:15') at time zone 'Europe/London' as yesterday_2115;
grant select on times to authenticated;

select throws_ok($$select public.log_meal('Too early', null, (select yesterday_start from times) - interval '1 minute', '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb)$$, '22023', 'pick a time from yesterday 00:00 onwards', 'before yesterday 00:00 is refused');
select lives_ok($$select public.log_meal('Midnight', null, (select yesterday_start from times), '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb)$$, 'yesterday 00:00 is the earliest');
select lives_ok($$select public.log_meal('An hour ahead', null, now() + interval '1 hour', '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb)$$, 'an hour from now is the latest');
select throws_ok($$select public.log_meal('Too late', null, now() + interval '1 hour 5 minutes', '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb)$$, '22023', 'pick a time no more than an hour from now', 'more than an hour ahead is refused');
select is((select count(*)::int from public.meal_logs where name in ('Too early', 'Too late')), 0, 'refused times leave nothing behind');

-- ---------------------------------------------------------------------------
-- g or ml
-- ---------------------------------------------------------------------------
create temp table shake_log as select public.log_meal('Test shake breakfast', null, now(), '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1},
  {"food_id":"fc000000-0000-0000-0000-000000000002","grams":330,"kcal":205,"protein":20.1,"carbs":21.8,"fat":4.0}
]'::jsonb) as id;
grant select on shake_log to authenticated;
select is((select string_agg(unit, ',' order by position) from public.meal_log_items where meal_log_id = (select id from shake_log)),
  'g,ml', 'with no unit sent, each item takes its food''s unit');
select is((select unit from public.food_portions_last where food_id = 'fc000000-0000-0000-0000-000000000002'), 'ml', 'last time remembers ml');
select lives_ok($$select public.log_meal('Shake in g', null, now(), '[
  {"food_id":"fc000000-0000-0000-0000-000000000002","grams":330,"unit":"g","kcal":205,"protein":20.1,"carbs":21.8,"fat":4.0}
]'::jsonb)$$, 'picking the other unit counts 1 ml as 1 g (same numbers)');
select is((select unit || ' ' || kcal from public.meal_log_items i join public.meal_logs l on l.id = i.meal_log_id where l.name = 'Shake in g'),
  'g 205', 'the chosen unit is stored, the numbers are the same');
select throws_ok($$select public.log_meal('Ounces', null, now(), '[
  {"food_id":"fc000000-0000-0000-0000-000000000002","grams":330,"unit":"oz","kcal":205,"protein":20.1,"carbs":21.8,"fat":4.0}
]'::jsonb)$$, '22023', null, 'units other than g and ml are refused');

create temp table drink_meal as select public.save_meal(null, 'Test drink meal', false, null, '[
  {"food_id":"fc000000-0000-0000-0000-00000000000a","grams":250},
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"unit":"g"}
]'::jsonb) as id;
grant select on drink_meal to authenticated;
select is((select string_agg(unit, ',' order by position) from public.saved_meal_components where saved_meal_id = (select id from drink_meal)),
  'ml,g', 'saved meals keep each amount''s unit');

-- ---------------------------------------------------------------------------
-- Edit a logged meal (7k): name, time and units only
-- ---------------------------------------------------------------------------
create temp table plan_meal as select public.save_meal(null, 'Lunch · Test oats bowl', true, '12:30', '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60}
]'::jsonb) as id;
grant select on plan_meal to authenticated;
create temp table plan_log as select public.log_meal('Lunch · Test oats bowl', (select id from plan_meal), now() - interval '10 minutes', '[
  {"food_id":"fc000000-0000-0000-0000-000000000001","grams":60,"kcal":233,"protein":8.1,"carbs":39.6,"fat":4.1}
]'::jsonb) as id;
grant select on plan_log to authenticated;

select lives_ok($$select public.update_logged_meal((select id from plan_log), '  Test overnight oats ', (select yesterday_2115 from times), null)$$,
  'rename and move to yesterday 21:15');
select is((select name from public.meal_logs where id = (select id from plan_log)), 'Test overnight oats', 'renamed (trimmed)');
select is((select logged_at from public.meal_logs where id = (select id from plan_log)), (select yesterday_2115 from times), 'moved to yesterday');
select isnt((select edited_at from public.meal_logs where id = (select id from plan_log)), null, 'edited_at kept internally');
select is((select name || ' ' || usual_time from public.saved_meals where id = (select id from plan_meal)), 'Lunch · Test oats bowl 12:30:00',
  'the plan meal it came from is unchanged');
select is((select grams || ' ' || kcal from public.meal_log_items where meal_log_id = (select id from plan_log)), '60.0 233', 'amounts unchanged');

select lives_ok($$select public.update_logged_meal((select id from plan_log), 'Test overnight oats', null, null)$$, 'a null time keeps the time');
select is((select logged_at from public.meal_logs where id = (select id from plan_log)), (select yesterday_2115 from times), 'time kept');
select throws_ok($$select public.update_logged_meal((select id from plan_log), 'Test overnight oats', now() + interval '2 hours', null)$$,
  '22023', 'pick a time no more than an hour from now', 'a new time must be in the window');
select throws_ok($$select public.update_logged_meal((select id from plan_log), '   ', null, null)$$, '22023', null, 'a name is needed');

select lives_ok($$select public.update_logged_meal((select id from shake_log), 'Test shake breakfast', null, '[{"position":0,"unit":"ml"}]'::jsonb)$$,
  'switch one item''s unit');
select is((select string_agg(unit || ' ' || grams || ' ' || kcal, ',' order by position) from public.meal_log_items where meal_log_id = (select id from shake_log)),
  'ml 60.0 233,ml 330.0 205', 'only the label changed');
select throws_ok($$select public.update_logged_meal((select id from shake_log), 'Test shake breakfast', null, '[{"position":0,"unit":"cups"}]'::jsonb)$$,
  '22023', null, 'units other than g and ml are refused on edit');

-- Amounts and components are locked, however they're changed.
select throws_ok($$update public.meal_log_items set grams = 90 where meal_log_id = (select id from shake_log) and position = 0$$,
  '42501', 'logged meals are changed only through Edit meal or Delete meal', 'amounts are locked');
select throws_ok($$update public.meal_log_items set kcal = 1 where meal_log_id = (select id from shake_log)$$,
  '42501', null, 'logged nutrition is locked');
select throws_ok($$update public.meal_log_items set unit = 'g' where meal_log_id = (select id from shake_log) and position = 0$$,
  '42501', null, 'even a unit label changes only through Edit meal');
select throws_ok($$update public.meal_logs set logged_at = now() - interval '3 days' where id = (select id from shake_log)$$,
  '42501', null, 'a direct retime is refused');
select throws_ok($$update public.meal_logs set name = 'Sneaky' where id = (select id from shake_log)$$,
  '42501', null, 'a direct rename is refused');
select throws_ok($$delete from public.meal_logs where id = (select id from shake_log)$$,
  '42501', null, 'a direct delete is refused');
select throws_ok($$delete from public.meal_log_items where meal_log_id = (select id from shake_log)$$,
  '42501', null, 'removing a component is refused');

-- A crafted edit can't sneak amounts, nutrition or components in.
select throws_ok($$select public.update_logged_meal((select id from shake_log), 'Test shake breakfast', null, '[{"position":0,"unit":"g","grams":90}]'::jsonb)$$,
  '42501', 'amounts can''t be changed; delete the meal and log it again', 'an amount in the edit is refused');
select throws_ok($$select public.update_logged_meal((select id from shake_log), 'Test shake breakfast', null, '[{"position":1,"unit":"ml","kcal":1}]'::jsonb)$$,
  '42501', null, 'nutrition in the edit is refused');
select throws_ok($$select public.update_logged_meal((select id from shake_log), 'Test shake breakfast', null, '[{"position":0,"unit":"g","food_id":"fc000000-0000-0000-0000-000000000002"}]'::jsonb)$$,
  '42501', null, 'swapping a component in the edit is refused');
select throws_ok($$select public.update_logged_meal((select id from shake_log), 'Test shake breakfast', null, '[{"position":7,"unit":"g"}]'::jsonb)$$,
  '22023', null, 'an item that isn''t in the meal is refused');
select is((select string_agg(unit || ' ' || grams || ' ' || kcal, ',' order by position) from public.meal_log_items where meal_log_id = (select id from shake_log)),
  'ml 60.0 233,ml 330.0 205', 'nothing changed after the refusals');

-- A meal from before yesterday is history: no edits, no deletes.
reset role;
insert into public.meal_logs (id, user_id, name, logged_at) values
  ('fc000000-0000-0000-0000-0000000000f1', 'a1a1a1a1-0000-0000-0000-0000000000c1', 'Old meal', now() - interval '3 days');
set local role authenticated;
select throws_ok($$select public.update_logged_meal('fc000000-0000-0000-0000-0000000000f1', 'Renamed', null, null)$$,
  '22023', 'meals from before yesterday can''t be changed', 'an old meal can''t be edited');
select throws_ok($$select public.delete_logged_meal('fc000000-0000-0000-0000-0000000000f1')$$,
  '22023', null, 'an old meal can''t be deleted');

-- ---------------------------------------------------------------------------
-- Other users
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$select public.update_logged_meal((select id from shake_log), 'Mine now', null, null)$$, 'P0002', null, 'B cannot edit A''s meal');
select throws_ok($$select public.delete_logged_meal((select id from shake_log))$$, 'P0002', null, 'B cannot delete A''s meal through the function');
select is((select count(*)::int from public.meal_logs where id = (select id from shake_log)), 0, 'B cannot see A''s meal');
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select name from public.meal_logs where id = (select id from shake_log)), 'Test shake breakfast', 'B cannot delete A''s meal');

-- ---------------------------------------------------------------------------
-- Delete (7l): a plan meal's log goes, so the plan meal shows as not eaten again
-- ---------------------------------------------------------------------------
select lives_ok($$select public.delete_logged_meal((select id from plan_log))$$, 'delete through the function');
select is((select count(*)::int from public.meal_logs where saved_meal_id = (select id from plan_meal)), 0, 'no log references the plan meal');
select is((select count(*)::int from public.meal_log_items where meal_log_id = (select id from plan_log)), 0, 'its items go with it');
select is((select count(*)::int from public.saved_meals where id = (select id from plan_meal)), 1, 'the plan meal itself stays');

-- A deleted food still lets its logs keep their snapshot (the guard allows the FK's SET NULL).
create temp table drink_log as select public.log_meal('Drink', null, now(), '[
  {"food_id":"fc000000-0000-0000-0000-00000000000a","grams":250,"kcal":113,"protein":2.5,"carbs":16.5,"fat":3.8}
]'::jsonb) as id;
grant select on drink_log to authenticated;
delete from public.saved_meal_components where food_id = 'fc000000-0000-0000-0000-00000000000a';
select lives_ok($$delete from public.foods where id = 'fc000000-0000-0000-0000-00000000000a'$$, 'deleting a logged food still works');
select is((select coalesce(food_id::text, 'gone') || ' ' || unit || ' ' || kcal from public.meal_log_items where meal_log_id = (select id from drink_log)),
  'gone ml 113', 'the log keeps its snapshot and unit');

-- Without consent nothing can be edited or deleted.
reset role;
update public.consents set withdrawn_at = now() where user_id = 'a1a1a1a1-0000-0000-0000-0000000000c1';
set local role authenticated;
select throws_ok($$select public.update_logged_meal((select id from drink_log), 'Drink', null, null)$$, '42501', null, 'no edits without health consent');
select throws_ok($$select public.delete_logged_meal((select id from drink_log))$$, '42501', null, 'no deletes without health consent');
reset role;
select is((select count(*)::int from public.meal_logs where id = (select id from drink_log)), 1, 'the meal is still there');
set local role authenticated;

reset role;
select * from finish();
rollback;
