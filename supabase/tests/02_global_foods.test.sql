-- Global Open Food Facts cache rows: readable by signed-in users, writable only by the service role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'user-a@example.test');

insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
values ('f0000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000009917', 'Test oats', 370, 13, 60, 7);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is((select name from public.foods where barcode = '0000000009917'), 'Test oats', 'signed-in user can read a global food');

select throws_ok(
  $$insert into public.foods (user_id, source, barcode, name) values (null, 'open_food_facts', '0000000009924', 'Forged')$$,
  '42501', null, 'user cannot insert into the global cache');
select throws_ok(
  $$insert into public.foods (user_id, source, barcode, name) values ('11111111-1111-1111-1111-111111111111', 'open_food_facts', '0000000009924', 'Forged')$$,
  '42501', null, 'user cannot create a row claiming to be from Open Food Facts');

update public.foods set name = 'Vandalised', kcal_per_100g = 1 where id = 'f0000000-0000-0000-0000-000000000001';
delete from public.foods where id = 'f0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
    values ('f0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'user', '0000000009917', 'My oats', 380, 12, 62, 8)$$,
  'user can create their own food, even with a barcode already in the cache');
select throws_ok(
  $$update public.foods set user_id = null, source = 'open_food_facts' where id = 'f0000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'user cannot promote their own food into the global cache');
select is(
  (select count(*)::int from public.foods where id in ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a')),
  2, 'user sees the global food and their own');

reset role;
select is((select name from public.foods where id = 'f0000000-0000-0000-0000-000000000001'), 'Test oats', 'global food not updated by user');
select is((select kcal_per_100g from public.foods where id = 'f0000000-0000-0000-0000-000000000001'), 370.00::numeric, 'global nutrition not changed by user');

set local role service_role;
select lives_ok(
  $$insert into public.foods (user_id, source, barcode, name) values (null, 'open_food_facts', '0000000009924', 'Cached by edge function')$$,
  'service role can write to the global cache');
select lives_ok(
  $$update public.foods set name = 'Refreshed' where barcode = '0000000009924' and user_id is null$$,
  'service role can refresh a cached food');
reset role;

select * from finish();
rollback;
