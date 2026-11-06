-- Phase 2C: user-created foods (7e), completing scanned products, pack sizes, isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('c3c3c3c3-0000-0000-0000-000000000003', 'foods-a@example.test'),
  ('d4d4d4d4-0000-0000-0000-000000000004', 'foods-b@example.test');

-- A partial global product, as food-lookup would cache it.
insert into public.foods (id, user_id, source, barcode, name, kcal_per_100g, carbs_per_100g, pack_g)
values ('e0000000-0000-0000-0000-000000000001', null, 'open_food_facts', '0000000000990', 'Sample sauce', 120, 28, 120);

select is((select remembered from public.foods where barcode = '0000000000990'), true, 'foods are remembered by default');
select throws_ok(
  $$insert into public.foods (user_id, source, barcode, name, pack_g) values (null, 'open_food_facts', '0000000000991', 'Bad', 0)$$,
  '23514', null, 'pack size must be positive');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c3c3c3c3-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is((select pack_g from public.foods where barcode = '0000000000990'), 120.0, 'signed-in users read pack size from the cache');

-- Complete the scanned product as your own food, with the label values
select lives_ok(
  $$insert into public.foods (user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, pack_g)
    values (auth.uid(), 'user', '0000000000990', 'Sample sauce', 120, 0.8, 28, 0.5, 120)$$,
  'user can complete a scanned product as their own food');
select throws_ok(
  $$insert into public.foods (user_id, source, barcode, name) values (auth.uid(), 'user', '0000000000990', 'Again')$$,
  '23505', null, 'one own food per barcode');
select lives_ok(
  $$update public.foods set protein_per_100g = 0.9 where user_id = auth.uid() and barcode = '0000000000990'$$,
  'and can correct it later');
select lives_ok(
  $$insert into public.foods (user_id, source, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, remembered)
    values (auth.uid(), 'user', 'Rice noodles, dried', 360, 6, 80, 1, false)$$,
  'user can add a food from the label without a barcode, not remembered');
select throws_ok(
  $$insert into public.foods (user_id, source, barcode, name) values (null, 'open_food_facts', '0000000000992', 'Fake cache')$$,
  '42501', null, 'users cannot write the global cache');
update public.foods set kcal_per_100g = 1 where barcode = '0000000000990' and user_id is null;
select is((select kcal_per_100g from public.foods where barcode = '0000000000990' and user_id is null), 120.00, 'users cannot change cached products');
select is((select count(*)::int from public.foods where user_id = auth.uid()), 2, 'A has two own foods');

-- User B: can't see A's foods, can have their own version of the same barcode
select set_config('request.jwt.claims', '{"sub":"d4d4d4d4-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.foods where user_id is not null), 0, 'B cannot see A''s foods');
select lives_ok(
  $$insert into public.foods (user_id, source, barcode, name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
    values (auth.uid(), 'user', '0000000000990', 'My sauce', 100, 1, 25, 0)$$,
  'B can have their own version of the same barcode');
update public.foods set name = 'Hacked' where name = 'Rice noodles, dried';
delete from public.foods where name = 'Rice noodles, dried';

reset role;
select is((select name from public.foods where kcal_per_100g = 360), 'Rice noodles, dried', 'B cannot update or delete A''s food');
select is((select count(*)::int from public.foods where barcode = '0000000000990'), 3, 'cache row plus one own row per user');

select * from finish();
rollback;
