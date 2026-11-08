-- Log meal follow-up: batches (save_batch recomputes per-100 g and refuses mismatches; the guard
-- keeps batch rows behind save_batch), batch_ingredients (owner only + health consent), stars,
-- cook again leaves logged meals alone, cross-user isolation and consent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, email) values
  ('a1a1a1a1-0000-0000-0000-0000000000b1', 'batch-a@example.test'),
  ('b2b2b2b2-0000-0000-0000-0000000000b2', 'batch-b@example.test');

-- Values from wireframe 7f: 360 g dry rice = 1,260 kcal; 120 g eggs = 172 kcal.
insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) values
  ('fb000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000000951', 'Sample rice, dry', 350, 7.0, 78.0, 0.6),
  ('fb000000-0000-0000-0000-000000000002', null, 'open_food_facts', '0000000000952', 'Test eggs, large', 143, 12.6, 0.7, 9.5),
  ('fb000000-0000-0000-0000-000000000003', null, 'open_food_facts', '0000000000953', 'Test incomplete', 120, null, 28.0, 0.5),
  ('fb000000-0000-0000-0000-00000000000b', 'b2b2b2b2-0000-0000-0000-0000000000b2', 'user', null, 'B''s own food', 100, 1, 1, 1);

insert into public.consents (user_id, type, policy_version) values
  ('a1a1a1a1-0000-0000-0000-0000000000b1', 'health_data', '2026-11-06'),
  ('b2b2b2b2-0000-0000-0000-0000000000b2', 'health_data', '2026-11-06');

select ok(not (select prosecdef from pg_proc where proname = 'save_batch'), 'save_batch is SECURITY INVOKER');
select ok((select relrowsecurity from pg_class where oid = 'public.batch_ingredients'::regclass), 'batch_ingredients has RLS on');
select ok(not has_table_privilege('anon', 'public.batch_ingredients', 'select'), 'anon cannot read batch_ingredients');
select ok(not has_function_privilege('anon', 'public.save_batch(uuid, text, numeric, boolean, jsonb, jsonb)', 'execute'), 'anon cannot call save_batch');
select has_column('public', 'saved_meals', 'starred', 'saved meals can be starred');
select has_column('public', 'foods', 'cooked_weight_weighed', 'batches record whether the weight was weighed');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

-- Estimated: 360 × 2.5 + 120 = 1,020 g. Whole batch 1,432 kcal · P 40.3 · C 281.6 · F 13.6.
-- Per 100 g = 140 kcal · P 4.0 · C 27.6 · F 1.3 (same as core).
create temp table b as
select public.save_batch(null, 'Egg fried rice', 1020, false,
  '{"kcal":140,"protein":4.0,"carbs":27.6,"fat":1.3}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":120,"cooks_as":"as_added","cooked_ratio":1}]') as id;
grant select on b to authenticated;

select isnt((select id from b), null, 'save_batch returns the batch id');
select is(
  (select row(is_batch, source, cooked_weight_g, cooked_weight_weighed, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)::text
   from public.foods where id = (select id from b)),
  '(t,user,1020.0,f,140.00,4.00,27.60,1.30)',
  'the batch is your own food with per-100 g = totals ÷ estimated cooked weight');
select is((select fibre_per_100g from public.foods where id = (select id from b)), null, 'unknown fibre stays null');
select is((select string_agg(cooks_as || ':' || cooked_ratio || ':' || grams, ',' order by position) from public.batch_ingredients),
  'rice:2.50:360.0,as_added:1.00:120.0', 'ingredients stored with their ratios');

-- The server doesn't trust client maths.
select throws_ok($$select public.save_batch(null, 'Tampered', 1020, false,
  '{"kcal":99,"protein":4.0,"carbs":27.6,"fat":1.3}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":120,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  '22023', 'nutrition for this batch has changed; refresh and try again', 'tampered per-100 g refused');
select throws_ok($$select public.save_batch(null, 'Missing', 1020, false, null,
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5}]')$$,
  '22023', null, 'per-100 g values are required');
select throws_ok($$select public.save_batch(null, 'Wrong estimate', 1000, false,
  '{"kcal":143,"protein":4.0,"carbs":28.2,"fat":1.4}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":120,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  '22023', null, 'an estimate that doesn''t match the ratios is refused');
select throws_ok($$select public.save_batch(null, 'Bad ratio', 1020, false,
  '{"kcal":140,"protein":4.0,"carbs":27.6,"fat":1.3}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"as_added","cooked_ratio":2.5}]')$$,
  '22023', null, '"as added" must be × 1');
select throws_ok($$select public.save_batch(null, 'Too light', 100, true,
  '{"kcal":1432,"protein":40.3,"carbs":281.6,"fat":13.6}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":120,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  '22023', null, 'a cooked weight under the macros that went in is refused');
select throws_ok($$select public.save_batch(null, 'Incomplete', 120, false,
  '{"kcal":100,"protein":0,"carbs":23.3,"fat":0.4}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000003","grams":120,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  '22023', null, 'an ingredient with missing nutrition is refused');
select throws_ok($$select public.save_batch(null, 'Batch in batch', 100, false,
  '{"kcal":140,"protein":4.0,"carbs":27.6,"fat":1.3}',
  format('[{"food_id":"%s","grams":100,"cooks_as":"as_added","cooked_ratio":1}]', (select id from b))::jsonb)$$,
  '22023', null, 'a batch can''t go in another batch');
select is((select count(*)::int from public.foods where is_batch), 1, 'refused batches leave nothing behind');

-- Batch rows only change through save_batch; starring is the exception.
select throws_ok($$update public.foods set kcal_per_100g = 50 where id = (select id from b)$$,
  '42501', null, 'per-100 g of a batch can''t be edited directly');
select throws_ok($$insert into public.foods (user_id, source, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_batch, cooked_weight_g, cooked_weight_weighed, cooked_at)
  values ('a1a1a1a1-0000-0000-0000-0000000000b1', 'user', 'Fake batch', 10, 1, 1, 1, true, 100, true, now())$$,
  '42501', null, 'a batch can''t be inserted directly');
select throws_ok($$insert into public.batch_ingredients (batch_id, food_id, grams)
  values ((select id from b), 'fb000000-0000-0000-0000-000000000002', 500)$$,
  '42501', null, 'ingredients can''t be added behind save_batch''s back without changing per-100 g');
update public.foods set starred = true where id = (select id from b);
select ok((select starred from public.foods where id = (select id from b)), 'a batch can be starred');

-- Weighed 1,310 g replaces the estimate: 1,432 × 100 ÷ 1,310 = 109.3 → 109 kcal.
select lives_ok($$select public.save_batch((select id from b), 'Egg fried rice', 1310, true,
  '{"kcal":109,"protein":3.1,"carbs":21.5,"fat":1.0}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":120,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  'weighed batch saved');
select is((select cooked_weight_g::text || ' ' || cooked_weight_weighed || ' ' || kcal_per_100g::int || ' ' || starred from public.foods where id = (select id from b)),
  '1310.0 true 109 true', 'the weighed value is used; the star stays');

-- Log 350 g of it (382 kcal), then cook again with one egg fewer: future logs change, the past doesn't.
select lives_ok(format($$select public.log_meal('Egg fried rice', null, now(),
  '[{"food_id":"%s","grams":350,"kcal":382,"protein":10.9,"carbs":75.3,"fat":3.5}]')$$, (select id from b)),
  'log 350 g of the batch');
-- Cook again: 360 × 2.5 + 60 = 960 g; 1,346 kcal → 140 per 100 g.
select lives_ok($$select public.save_batch((select id from b), 'Egg fried rice', 960, false,
  '{"kcal":140,"protein":3.4,"carbs":29.3,"fat":0.8}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":60,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  'cook again with one ingredient changed');
select is((select count(*)::int || ' ' || max(grams) filter (where food_id = 'fb000000-0000-0000-0000-000000000002')::text from public.batch_ingredients), '2 60.0', 'ingredients replaced, not added');
select is((select kcal from public.meal_log_items where food_id = (select id from b)), 382, 'the meal logged before keeps its snapshot');
select throws_ok(format($$select public.log_meal('Old numbers', null, now(),
  '[{"food_id":"%s","grams":350,"kcal":382,"protein":10.9,"carbs":75.3,"fat":3.5}]')$$, (select id from b)),
  '22023', null, 'new logs must use the new per-100 g');
select lives_ok(format($$select public.log_meal('New numbers', null, now(),
  '[{"food_id":"%s","grams":350,"kcal":490,"protein":11.9,"carbs":102.6,"fat":2.8}]')$$, (select id from b)),
  'new logs use the new per-100 g');

-- A batch is a component like any food.
select lives_ok(format($$select public.save_meal(null, 'Rice & eggs', false, null,
  '[{"food_id":"%s","grams":350}]')$$, (select id from b)), 'a batch can be a component of a saved meal');
update public.saved_meals set starred = true where name = 'Rice & eggs';
select ok((select starred from public.saved_meals where name = 'Rice & eggs'), 'a saved meal can be starred');

-- User B sees none of it and can't touch it.
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from public.foods where is_batch) + (select count(*)::int from public.batch_ingredients), 0, 'B sees none of A''s batches or ingredients');
select throws_ok($$select public.save_batch((select id from b), 'Mine now', 100, true,
  '{"kcal":100,"protein":1.0,"carbs":1.0,"fat":1.0}',
  '[{"food_id":"fb000000-0000-0000-0000-00000000000b","grams":100,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  'P0002', null, 'B can''t cook A''s batch again');
select throws_ok($$insert into public.batch_ingredients (batch_id, user_id, food_id, grams)
  values ((select id from b), 'b2b2b2b2-0000-0000-0000-0000000000b2', 'fb000000-0000-0000-0000-00000000000b', 100)$$,
  '42501', null, 'B can''t attach an ingredient to A''s batch');
-- Even with the guard lifted, the composite FK stops an ingredient joining another user's batch.
reset role;
select set_config('lifeos.save_batch', 'on', true);
select throws_ok($$insert into public.batch_ingredients (batch_id, user_id, food_id, grams)
  values ((select id from b), 'b2b2b2b2-0000-0000-0000-0000000000b2', 'fb000000-0000-0000-0000-00000000000b', 100)$$,
  '23503', null, 'composite FK: an ingredient belongs to a batch of the same user');
select set_config('lifeos.save_batch', 'off', true);
set local role authenticated;
update public.foods set starred = false where id = (select id from b);
select throws_ok(format($$select public.log_meal('Steal', null, now(),
  '[{"food_id":"%s","grams":100,"kcal":140,"protein":3.4,"carbs":29.3,"fat":0.8}]')$$, (select id from b)),
  '22023', null, 'B can''t log A''s batch');

-- A withdraws consent: batches are health data.
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select ok((select starred from public.foods where id = (select id from b)), 'B''s unstar touched nothing');
reset role;
update public.consents set withdrawn_at = now() where user_id = 'a1a1a1a1-0000-0000-0000-0000000000b1';
set local role authenticated;
select throws_ok($$select public.save_batch(null, 'No consent', 1020, false,
  '{"kcal":140,"protein":4.0,"carbs":27.6,"fat":1.3}',
  '[{"food_id":"fb000000-0000-0000-0000-000000000001","grams":360,"cooks_as":"rice","cooked_ratio":2.5},
    {"food_id":"fb000000-0000-0000-0000-000000000002","grams":120,"cooks_as":"as_added","cooked_ratio":1}]')$$,
  '42501', 'health data is off', 'consent off: save_batch refused');
select is((select count(*)::int from public.foods where is_batch) + (select count(*)::int from public.batch_ingredients), 0, 'consent off: batches and ingredients hidden');
update public.foods set starred = false where id = (select id from b);
select throws_ok($$insert into public.batch_ingredients (batch_id, food_id, grams)
  values ((select id from b), 'fb000000-0000-0000-0000-000000000001', 10)$$,
  '42501', null, 'consent off: no ingredient writes');
reset role;
select ok((select starred from public.foods where id = (select id from b)), 'consent off: the star can''t be changed');

select * from finish();
rollback;
