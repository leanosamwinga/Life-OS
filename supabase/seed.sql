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

-- To try the app locally, create an account in the app (codes arrive in Mailpit,
-- http://127.0.0.1:54324), or use the ready-made local account below.

-- ---------------------------------------------------------------------------
-- Local development account — LOCAL ONLY. Never reuse this password anywhere.
--   Email admin@example.test, password "lifeos-local-admin-2026" (23 characters, not in the
--   breach fixture). In development builds (__DEV__) the bare username "admin" also works.
--   A confirmed PASSWORD account: already onboarded, health-data consent on, targets and a
--   few plan meals set, so you land straight on Today. The seed never runs against the
--   hosted project (`supabase db push` doesn't apply it). Skipped on the plain-Postgres shim.
--
--   Supabase Auth stores bcrypt(base64url(HMAC-SHA256(pepper, NFKC(password)))) — see
--   supabase/functions/auth-api/password.ts. The pepper below is the documented LOCAL
--   default (AUTH_PASSWORD_PEPPER_V1 in supabase/functions/.env.example); the hosted
--   project uses its own secret, so this hash is useless there.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id constant uuid := '00000000-0000-4000-8000-00000000ad01';
  v_meal uuid;
begin
  if to_regclass('auth.refresh_tokens') is null then
    raise notice 'seed: no Supabase Auth schema here, skipping the local admin account';
    return;
  end if;
  if exists (select 1 from auth.users where id = v_id) then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    'admin@example.test',
    extensions.crypt(
      translate(rtrim(encode(extensions.hmac(
        convert_to(normalize('lifeos-local-admin-2026', NFKC), 'UTF8'),
        convert_to('local-dev-pepper-NOT-A-SECRET', 'UTF8'), 'sha256'), 'base64'), '='), '+/', '-_'),
      extensions.gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Admin"}', now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', 'admin@example.test', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.auth_accounts (user_id, email, method, status, confirmed_at, password_changed_at, pepper_version)
  values (v_id, 'admin@example.test', 'PASSWORD', 'ACTIVE', now(), now(), 1);

  -- handle_new_user() created the profile and settings; finish onboarding.
  insert into public.consents (user_id, type, policy_version) values (v_id, 'health_data', '2026-11-06');
  update public.user_settings
     set onboarding_completed_at = now(), apple_health_choice = 'not_now', screen_time_choice = 'not_now',
         target_kcal = 2450, target_protein_g = 180, target_carbs_g = 250, target_fat_g = 75,
         target_water_ml = 3000, target_steps = 10000
   where user_id = v_id;

  -- A small plan so Today has "Ate it" rows (foods are the fake ones above).
  insert into public.saved_meals (user_id, name, in_daily_plan, usual_time, sort_order)
  values (v_id, 'Breakfast · porridge & yoghurt', true, '08:00', 0) returning id into v_meal;
  insert into public.saved_meal_components (saved_meal_id, user_id, food_id, grams, position)
  select v_meal, v_id, f.id, g.grams, g.pos
    from (values ('0000000000055', 80, 0), ('0000000000017', 150, 1)) as g(barcode, grams, pos)
    join public.foods f on f.barcode = g.barcode and f.user_id is null;

  insert into public.saved_meals (user_id, name, in_daily_plan, usual_time, sort_order)
  values (v_id, 'Lunch · chicken rice bowl', true, '12:30', 1) returning id into v_meal;
  insert into public.saved_meal_components (saved_meal_id, user_id, food_id, grams, position)
  select v_meal, v_id, f.id, g.grams, g.pos
    from (values ('0000000000024', 200, 0), ('0000000000031', 200, 1)) as g(barcode, grams, pos)
    join public.foods f on f.barcode = g.barcode and f.user_id is null;

  insert into public.saved_meals (user_id, name, in_daily_plan, usual_time, sort_order)
  values (v_id, 'Snack · yoghurt', true, '16:00', 2) returning id into v_meal;
  insert into public.saved_meal_components (saved_meal_id, user_id, food_id, grams, position)
  select v_meal, v_id, f.id, 200, 0 from public.foods f where f.barcode = '0000000000017' and f.user_id is null;
end;
$$;
