-- Local development seed. Obviously fake data only — never real personal data.
-- Applied by `supabase db reset`. Global food rows mimic the Open Food Facts cache
-- (user_id NULL); barcodes are fake and will not match real products.

insert into public.foods
  (user_id, source, barcode, name, brand, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fibre_per_100g, sugar_per_100g, salt_per_100g, off_fetched_at)
values
  (null, 'open_food_facts', '0000000000017', 'Greek yoghurt 0%', 'Sample Dairy', 57, 10.0, 3.6, 0.2, null, 3.6, 0.1, now()),
  (null, 'open_food_facts', '0000000000024', 'Chicken breast, raw', 'Sample Farm', 106, 24.0, 0, 1.2, 0, 0, 0.1, now()),
  (null, 'open_food_facts', '0000000000031', 'Basmati rice, cooked', 'Sample Rice Co', 130, 2.7, 28.0, 0.3, 0.4, 0.1, 0, now()),
  (null, 'open_food_facts', '0000000000048', 'Sweet chilli sauce', 'Sample Sauces', 120, 0.8, 28.0, 0.5, null, 26.0, 1.9, now()),
  (null, 'open_food_facts', '0000000000055', 'Porridge oats', 'Sample Mills', 375, 11.0, 60.0, 8.0, 9.0, 1.1, 0, now())
on conflict do nothing;

-- To try the app locally, sign up through the app or create a user in Studio
-- (http://127.0.0.1:54323), then grant health consent from Me → Privacy & data.
