-- Phase 2A: onboarding choices in user_settings, first name from sign-in metadata,
-- and cross-user isolation for profiles and settings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'onboard-a@example.test', '{"full_name":"Sample Person"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'onboard-b@example.test', '{"given_name":"Testy","name":"Ignored Name"}'),
  ('cccccccc-0000-0000-0000-00000000000c', 'onboard-c@example.test', '{}');

-- First name from Apple/Google metadata
select is((select display_name from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'Sample', 'first word of full_name');
select is((select display_name from public.profiles where id = 'bbbbbbbb-0000-0000-0000-00000000000b'), 'Testy', 'given_name wins over name');
select is((select display_name from public.profiles where id = 'cccccccc-0000-0000-0000-00000000000c'), null, 'no metadata, no invented name');

-- Defaults: nothing chosen yet
select ok(
  (select apple_health_choice is null and screen_time_choice is null and onboarding_completed_at is null
     from public.user_settings where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  'onboarding choices start empty');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$update public.user_settings
      set apple_health_choice = 'connect', screen_time_choice = 'not_now',
          morning_briefing_enabled = false, notifications_prompted_at = now(),
          target_kcal = 2450, target_water_ml = 3000, onboarding_completed_at = now()$$,
  'owner can save onboarding choices, nudges and targets');
select is((select apple_health_choice from public.user_settings), 'connect', 'choice saved');
select throws_ok(
  $$update public.user_settings set apple_health_choice = 'maybe'$$,
  '23514', null, 'unknown choice rejected');
select lives_ok($$update public.profiles set display_name = 'Renamed'$$, 'owner can set first name');
select is((select count(*)::int from public.user_settings), 1, 'user A sees only their own settings');
select is((select count(*)::int from public.profiles), 1, 'user A sees only their own profile');

-- User B cannot touch A's rows
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
update public.user_settings set onboarding_completed_at = null, target_kcal = 1
  where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
update public.profiles set display_name = 'Hacked' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select is_empty($$select 1 from public.user_settings where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, 'B cannot read A''s settings');
select throws_ok(
  $$insert into public.user_settings (user_id) values ('bbbbbbbb-0000-0000-0000-00000000000b')$$,
  '42501', null, 'settings rows cannot be inserted by users');

reset role;
select is((select target_kcal from public.user_settings where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 2450, 'B''s update did not change A''s targets');
select isnt((select onboarding_completed_at from public.user_settings where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), null, 'A''s onboarding stays complete');
select is((select display_name from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'Renamed', 'B''s update did not change A''s name');

-- anon has no access at all
set local role anon;
select throws_ok($$select 1 from public.user_settings$$, '42501', null, 'anon cannot read settings');

reset role;
select * from finish();
rollback;
