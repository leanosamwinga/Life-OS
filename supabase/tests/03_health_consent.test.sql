-- Health data is only processed with explicit, active consent (Privacy Policy §3).
-- Also covers new-user bootstrap and the consent audit trail.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'user-a@example.test', '{"display_name":"Test User"}');

-- Bootstrap trigger
select is((select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Test User', 'profile created on sign-up');
select is((select morning_briefing_weekday_time from public.user_settings where user_id = '11111111-1111-1111-1111-111111111111'), '07:30'::time, 'morning briefing defaults to 07:30');
select ok((select not event_reminders_enabled and urgent_bill_alerts_enabled from public.user_settings where user_id = '11111111-1111-1111-1111-111111111111'), 'event reminders off, urgent bill alerts on by default');
select is((select quiet_hours_start || '–' || quiet_hours_end from public.user_settings where user_id = '11111111-1111-1111-1111-111111111111'), '22:30:00–07:00:00', 'quiet hours default to 22:30–07:00');

-- Existing health row written before consent was withdrawn (as owner).
insert into public.water_logs (user_id, ml, logged_at) values ('11111111-1111-1111-1111-111111111111', 750, '2026-11-01T09:00:00Z');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- No consent yet
select throws_ok($$insert into public.water_logs (ml) values (250)$$, '42501', null, 'no water logging without health consent');
select throws_ok($$insert into public.meal_logs (name) values ('Lunch')$$, '42501', null, 'no meal logging without health consent');
select is_empty('select 1 from public.water_logs', 'health rows are hidden without consent');

-- Grant
select lives_ok($$insert into public.consents (type, policy_version) values ('health_data', '2026-11-06')$$, 'user can grant health consent');
select lives_ok($$insert into public.water_logs (ml) values (250)$$, 'water logging works with consent');
select is((select sum(ml)::int from public.water_logs), 1000, 'health rows visible with consent');

-- Audit trail
select throws_ok(
  $$update public.consents set granted_at = now() - interval '1 year' where type = 'health_data'$$,
  'P0001', null, 'granted_at cannot be rewritten');
select throws_ok($$delete from public.consents$$, '42501', null, 'consents cannot be deleted by the user');

-- Withdraw
update public.consents set withdrawn_at = now() where type = 'health_data' and withdrawn_at is null;
select is_empty('select 1 from public.water_logs', 'withdrawing consent stops access to health rows');
select throws_ok($$insert into public.water_logs (ml) values (250)$$, '42501', null, 'and stops new health logging');

reset role;
select * from finish();
rollback;
