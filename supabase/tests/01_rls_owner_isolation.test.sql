-- A user can neither read nor write another user's rows.
-- User A = 1111…, user B = 2222…. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------------------
-- Setup (as the database owner, like the service role)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'user-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@example.test');

insert into public.consents (user_id, type) values
  ('11111111-1111-1111-1111-111111111111', 'health_data'),
  ('22222222-2222-2222-2222-222222222222', 'health_data');

insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) values
  ('f0000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000009917', 'Test oats', 370, 13, 60, 7),
  ('f0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'user', null, 'B secret recipe', 100, 1, 1, 1);

insert into public.saved_meals (id, user_id, name, in_daily_plan, usual_time) values
  ('a0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'B breakfast', true, '08:00');
insert into public.saved_meal_components (saved_meal_id, user_id, food_id, grams) values
  ('a0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000001', 80);
insert into public.meal_logs (id, user_id, name, logged_at) values
  ('b0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'B lunch', '2026-11-06T12:30:00Z');
insert into public.meal_log_items (meal_log_id, user_id, food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g) values
  ('b0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000001', 'Test oats', 80, 296, 10.4, 48, 5.6);
insert into public.food_portions_last (user_id, food_id, grams) values
  ('22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000001', 80);
insert into public.water_logs (id, user_id, ml) values
  ('c0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 500);
insert into public.supplements (id, user_id, name, dose) values
  ('d0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Test vitamin', '1 tab');
insert into public.supplement_logs (user_id, supplement_id) values
  ('22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-00000000000b');

-- ---------------------------------------------------------------------------
-- Act as user A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- Reads: A sees only their own rows.
select is((select count(*)::int from public.profiles), 1, 'A sees exactly one profile (their own)');
select is((select id from public.profiles), '11111111-1111-1111-1111-111111111111'::uuid, 'and it is A''s');
select is((select count(*)::int from public.user_settings), 1, 'A sees only their own settings');
select is((select count(*)::int from public.consents), 1, 'A sees only their own consents');
select is((select count(*)::int from public.foods where user_id is not null), 0, 'A cannot see B''s private foods');
select is_empty('select 1 from public.saved_meals', 'A cannot read B''s saved meals');
select is_empty('select 1 from public.saved_meal_components', 'A cannot read B''s saved meal components');
select is_empty('select 1 from public.meal_logs', 'A cannot read B''s meal logs');
select is_empty('select 1 from public.meal_log_items', 'A cannot read B''s meal log items');
select is_empty('select 1 from public.food_portions_last', 'A cannot read B''s last portions');
select is_empty('select 1 from public.water_logs', 'A cannot read B''s water logs');
select is_empty('select 1 from public.supplements', 'A cannot read B''s supplements');
select is_empty('select 1 from public.supplement_logs', 'A cannot read B''s supplement logs');

-- Writes as B: rejected by RLS (42501).
select throws_ok(
  $$insert into public.water_logs (user_id, ml) values ('22222222-2222-2222-2222-222222222222', 250)$$,
  '42501', null, 'A cannot insert water logs for B');
select throws_ok(
  $$insert into public.meal_logs (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'forged')$$,
  '42501', null, 'A cannot insert meal logs for B');
select throws_ok(
  $$insert into public.saved_meals (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'forged')$$,
  '42501', null, 'A cannot insert saved meals for B');
select throws_ok(
  $$insert into public.foods (user_id, source, name) values ('22222222-2222-2222-2222-222222222222', 'user', 'forged')$$,
  '42501', null, 'A cannot insert foods for B');
select throws_ok(
  $$insert into public.consents (user_id, type) values ('22222222-2222-2222-2222-222222222222', 'product_emails')$$,
  '42501', null, 'A cannot grant consent on B''s behalf');
select throws_ok(
  $$insert into public.supplement_logs (user_id, supplement_id) values ('22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'A cannot log B''s supplements');

-- Attaching own rows to B's parents fails (composite foreign keys).
select throws_ok(
  $$insert into public.meal_log_items (meal_log_id, food_name, grams, kcal, protein_g, carbs_g, fat_g)
    values ('b0000000-0000-0000-0000-00000000000b', 'sneaky', 10, 1, 0, 0, 0)$$,
  '23503', null, 'A cannot add items to B''s meal log');
select throws_ok(
  $$insert into public.saved_meal_components (saved_meal_id, food_id, grams)
    values ('a0000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000001', 10)$$,
  '23503', null, 'A cannot add components to B''s saved meal');
select throws_ok(
  $$insert into public.meal_logs (name, saved_meal_id) values ('from B roster', 'a0000000-0000-0000-0000-00000000000b')$$,
  '23503', null, 'A cannot log a meal from B''s roster');

-- Using B's private food in A's own meal fails.
insert into public.saved_meals (id, name) values ('a0000000-0000-0000-0000-00000000000a', 'A lunch');
select throws_ok(
  $$insert into public.saved_meal_components (saved_meal_id, food_id, grams)
    values ('a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000b', 100)$$,
  '42501', null, 'A cannot use B''s private food in their own meal');

-- Updates and deletes against B's rows silently affect nothing.
update public.water_logs set ml = 1 where id = 'c0000000-0000-0000-0000-00000000000b';
delete from public.meal_logs where id = 'b0000000-0000-0000-0000-00000000000b';
delete from public.saved_meals where id = 'a0000000-0000-0000-0000-00000000000b';
delete from public.foods where id = 'f0000000-0000-0000-0000-00000000000b';
update public.user_settings set target_kcal = 1 where user_id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'hacked' where id = '22222222-2222-2222-2222-222222222222';
update public.consents set withdrawn_at = now() where user_id = '22222222-2222-2222-2222-222222222222';

-- A's own data works.
select lives_ok($$insert into public.water_logs (ml) values (250)$$, 'A can log their own water');
select lives_ok(
  $$insert into public.saved_meal_components (saved_meal_id, food_id, grams)
    values ('a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 200)$$,
  'A can build a meal from a global food');
select is((select count(*)::int from public.water_logs), 1, 'A sees their own water log');
select lives_ok($$update public.user_settings set target_kcal = 2450$$, 'A can update their own targets');

-- ---------------------------------------------------------------------------
-- Verify B's data is untouched (as owner)
-- ---------------------------------------------------------------------------
reset role;
select is((select ml from public.water_logs where id = 'c0000000-0000-0000-0000-00000000000b'), 500, 'B''s water log unchanged');
select is((select count(*)::int from public.meal_logs where id = 'b0000000-0000-0000-0000-00000000000b'), 1, 'B''s meal log not deleted');
select is((select count(*)::int from public.saved_meals where id = 'a0000000-0000-0000-0000-00000000000b'), 1, 'B''s saved meal not deleted');
select is((select count(*)::int from public.foods where id = 'f0000000-0000-0000-0000-00000000000b'), 1, 'B''s food not deleted');
select ok((select target_kcal is null from public.user_settings where user_id = '22222222-2222-2222-2222-222222222222'), 'B''s settings unchanged');
select ok((select display_name is null from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'B''s profile unchanged');
select ok((select withdrawn_at is null from public.consents where user_id = '22222222-2222-2222-2222-222222222222'), 'B''s consent not withdrawn by A');

-- Anonymous (signed-out) requests get nothing at all.
set local role anon;
select throws_ok('select 1 from public.foods', '42501', null, 'anon cannot read foods');
reset role;

select * from finish();
rollback;
