-- Sign-in v3: server-only tables (RLS on, nothing for anon/authenticated), the wrong-password
-- pause and quiet check, the Supabase Auth hooks and guards, the Data API guard, and the
-- day-30 deletion job.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

-- ---------------------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'v3-a@example.test'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'v3-b@example.test'),
  ('c3c3c3c3-0000-4000-8000-000000000003', 'v3-c@example.test');
insert into public.auth_accounts (user_id, email, method, status, confirmed_at, pepper_version) values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'V3-A@example.test', 'PASSWORD', 'ACTIVE', now(), 1),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'v3-b@example.test', 'GOOGLE', 'ACTIVE', now(), null);
insert into public.auth_federated_identities (user_id, provider, subject, email_at_provider, apple_refresh_token_enc)
values ('b2b2b2b2-0000-4000-8000-000000000002', 'GOOGLE', 'google-sub-b', 'v3-b@example.test', null);

-- ---------------------------------------------------------------------------- lock-down
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'auth\_%' and c.relkind = 'r'),
  'RLS is on for every auth_* table');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'auth\_%' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0, 'anon and authenticated have no privileges on any auth_* table');
select ok(
  (select bool_and(has_table_privilege('service_role', format('public.%I', c.relname), 'select'))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'auth\_%' and c.relkind = 'r'),
  'service_role can use every auth_* table');
select ok(
  (select bool_and(exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'set_updated_at'))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join information_schema.columns col on col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'updated_at'
    where n.nspname = 'public' and c.relname like 'auth\_%' and c.relkind = 'r'),
  'every auth_* table with updated_at has the set_updated_at trigger');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated","session_id":"00000000-0000-0000-0000-000000000000","lifeos_scope":"FULL"}', true);
select throws_ok($$select * from public.auth_accounts$$, '42501', null, 'a signed-in user cannot read even their own account row');
select throws_ok($$select * from public.auth_one_time_codes$$, '42501', null, 'codes are server-only');
select throws_ok($$select * from public.auth_reset_tokens$$, '42501', null, 'reset tokens are server-only');
select throws_ok($$select * from public.auth_session_meta$$, '42501', null, 'session details are server-only');
select throws_ok($$insert into public.auth_permits (purpose, user_id, expires_at) values ('ISSUE_SESSION', 'a1a1a1a1-0000-4000-8000-000000000001', now() + interval '1 minute')$$,
  '42501', null, 'a user cannot write themselves a permit');
select throws_ok($$select public.auth_record_wrong_password('x', null, 'd', 'i', now())$$, '42501', null, 'pause function not callable by users');
select throws_ok($$select public.auth_run_due_deletions(now())$$, '42501', null, 'deletion job not callable by users');
reset role;
set local role anon;
select throws_ok($$select * from public.auth_accounts$$, '42501', null, 'anon denied');
select throws_ok($$select * from public.auth_breached_hashes$$, '42501', null, 'anon cannot read the breach dataset directly');
reset role;

-- ---------------------------------------------------------------------------- one account per email
select throws_ok(
  $$insert into public.auth_accounts (user_id, email, method, status, confirmed_at) values ('c3c3c3c3-0000-4000-8000-000000000003', ' v3-a@EXAMPLE.test ', 'APPLE', 'ACTIVE', now())$$,
  '23505', null, 'one account per normalised email, whatever the method');
select is((select email_norm from public.auth_accounts where user_id = 'a1a1a1a1-0000-4000-8000-000000000001'), 'v3-a@example.test', 'email_norm trims and lower-cases');
select throws_ok(
  $$insert into public.auth_federated_identities (user_id, provider, subject) values ('b2b2b2b2-0000-4000-8000-000000000002', 'APPLE', 'apple-sub-b')$$,
  '23505', null, 'at most one federated identity per account');

-- ---------------------------------------------------------------------------- pause ladder (spec 4.1)
select is(public.auth_pause_interval(1), interval '15 minutes', 'first pause is 15 minutes');
select is(public.auth_pause_interval(2), interval '30 minutes', 'then 30');
select is(public.auth_pause_interval(4), interval '120 minutes', 'then 120');
select is(public.auth_pause_interval(20), interval '24 hours', 'capped at 24 hours');

select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:00Z'), null, '1st wrong: no pause');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:01Z'), null, '2nd');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:02Z'), null, '3rd');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:03Z'), null, '4th');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:04Z'),
  '2026-11-08 10:19Z'::timestamptz, '5th wrong in 15 minutes: paused for 15 minutes');
select is(public.auth_active_pause('v3-a@example.test', 'dev2', 'ip2', '2026-11-08 10:05Z'), null, 'another device and IP are not paused');
select is(public.auth_active_pause('v3-a@example.test', 'dev2', 'ip1', '2026-11-08 10:05Z'), '2026-11-08 10:19Z'::timestamptz, 'the same IP is paused for this email');
select is(public.auth_active_pause('someone-else@example.test', 'dev1', 'ip1', '2026-11-08 10:05Z'), null, 'the pause is per email: a shared IP does not block others');
select is((select status from public.auth_accounts where user_id = 'a1a1a1a1-0000-4000-8000-000000000001'), 'ACTIVE', 'the account itself is never locked');

select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:20Z'), null, 'after the pause, counting starts again');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:21Z'), null, '2');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:22Z'), null, '3');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:23Z'), null, '4');
select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-08 10:24Z'),
  '2026-11-08 10:54Z'::timestamptz, 'continuing: the pause doubles to 30 minutes');

select is(public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev1', 'ip1', '2026-11-09 11:00Z'), null, '24 h later: back to counting');
select ok((select level from public.auth_sign_in_pauses where key_kind = 'device' and key_hash = 'dev1') is null, 'and the ladder was reset after 24 h without failures');

-- ---------------------------------------------------------------------------- quiet check (spec 4.2)
select ok(not (select step_up_required from public.auth_accounts where user_id = 'a1a1a1a1-0000-4000-8000-000000000001'), '11 failures from 2 keys: no flag');
select public.auth_record_wrong_password('v3-a@example.test', 'a1a1a1a1-0000-4000-8000-000000000001', 'dev-' || g, 'ip-' || g, '2026-11-09 12:00Z'::timestamptz + g * interval '1 minute')
  from generate_series(1, 19) g;
select ok((select step_up_required from public.auth_accounts where user_id = 'a1a1a1a1-0000-4000-8000-000000000001'), '20 failures in 24 h from >= 3 keys sets step_up_required');

-- ---------------------------------------------------------------------------- hooks
select ok(public.auth_before_user_created_hook('{"user":{"email":"x@example.test","app_metadata":{"provider":"email"}}}') ? 'error',
  'before-user-created refuses every public way of creating a user');
select ok(public.auth_custom_access_token_hook(jsonb_build_object(
    'user_id', 'a1a1a1a1-0000-4000-8000-000000000001', 'authentication_method', 'password',
    'claims', jsonb_build_object('sub', 'a1a1a1a1-0000-4000-8000-000000000001'))) ? 'error',
  'custom-access-token: a fresh sign-in without an auth-api permit is refused');
insert into public.auth_permits (purpose, user_id, expires_at) values ('ISSUE_SESSION', 'a1a1a1a1-0000-4000-8000-000000000001', now() + interval '30 seconds');
select is(public.auth_custom_access_token_hook(jsonb_build_object(
    'user_id', 'a1a1a1a1-0000-4000-8000-000000000001', 'authentication_method', 'password',
    'claims', jsonb_build_object('sub', 'a1a1a1a1-0000-4000-8000-000000000001'))) -> 'claims' ->> 'lifeos_scope',
  'FULL', 'with a permit the token is issued, with lifeos_scope FULL');
select ok(public.auth_custom_access_token_hook(jsonb_build_object(
    'user_id', 'a1a1a1a1-0000-4000-8000-000000000001', 'authentication_method', 'password',
    'claims', jsonb_build_object('sub', 'a1a1a1a1-0000-4000-8000-000000000001'))) ? 'error',
  'a permit works once');
insert into public.auth_permits (purpose, user_id, expires_at) values ('ISSUE_SESSION', 'a1a1a1a1-0000-4000-8000-000000000001', now() - interval '1 second');
select ok(public.auth_custom_access_token_hook(jsonb_build_object(
    'user_id', 'a1a1a1a1-0000-4000-8000-000000000001', 'authentication_method', 'otp',
    'claims', jsonb_build_object('sub', 'a1a1a1a1-0000-4000-8000-000000000001'))) ? 'error',
  'an expired permit does not work');
select ok(public.auth_custom_access_token_hook(jsonb_build_object(
    'user_id', 'a1a1a1a1-0000-4000-8000-000000000001', 'authentication_method', 'token_refresh',
    'claims', jsonb_build_object('sub', 'a1a1a1a1-0000-4000-8000-000000000001'))) ? 'error',
  'a refresh without an auth-api permit is refused');
select ok(public.auth_custom_access_token_hook(jsonb_build_object(
    'user_id', 'c3c3c3c3-0000-4000-8000-000000000003', 'authentication_method', 'token_refresh',
    'claims', jsonb_build_object('sub', 'c3c3c3c3-0000-4000-8000-000000000003'))) ? 'error',
  'a user with no Life OS account gets no token');
select is(public.auth_send_email_hook('{"email_data":{"email_action_type":"magiclink"}}'), '{}'::jsonb, 'send-email hook sends nothing');

-- ---------------------------------------------------------------------------- guards on Supabase Auth tables
select throws_ok($$insert into auth.identities (user_id, provider, provider_id, identity_data) values ('a1a1a1a1-0000-4000-8000-000000000001', 'google', 'g', '{}')$$,
  'P0001', null, 'no Apple/Google identities in auth.identities');
insert into auth.identities (user_id, provider, provider_id, identity_data) values ('a1a1a1a1-0000-4000-8000-000000000001', 'email', 'a1a1a1a1-0000-4000-8000-000000000001', '{"sub":"a1a1a1a1-0000-4000-8000-000000000001"}');
select throws_ok($$insert into auth.identities (user_id, provider, provider_id, identity_data) values ('a1a1a1a1-0000-4000-8000-000000000001', 'email', 'second', '{}')$$,
  'P0001', null, 'one identity per user');
select throws_ok($$update auth.users set encrypted_password = 'x' where id = 'a1a1a1a1-0000-4000-8000-000000000001'$$,
  'P0001', null, 'password changes need an auth-api permit');

-- ---------------------------------------------------------------------------- Data API guard
insert into auth.sessions (id, user_id) values ('5e551011-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e551011-0000-4000-8000-000000000001","lifeos_scope":"FULL"}', true);
select lives_ok($$select public.check_request()$$, 'a live FULL session passes');
delete from auth.sessions where id = '5e551011-0000-4000-8000-000000000001';
select throws_ok($$select public.check_request()$$, 'PGRST', null, 'a signed-out session is refused at once');

-- ---------------------------------------------------------------------------- day-30 deletion job
insert into public.consents (user_id, type, policy_version) values ('b2b2b2b2-0000-4000-8000-000000000002', 'health_data', '2026-11-06');
update public.auth_federated_identities set apple_refresh_token_enc = 'v1.fake.ciphertext' where user_id = 'b2b2b2b2-0000-4000-8000-000000000002';
update public.auth_accounts set status = 'PENDING_DELETION' where user_id = 'b2b2b2b2-0000-4000-8000-000000000002';
insert into public.auth_deletion_requests (user_id, requested_at, due_at)
values ('b2b2b2b2-0000-4000-8000-000000000002', now() - interval '30 days', now() - interval '1 minute');
select is(public.auth_run_due_deletions(now()), 1, 'one due deletion runs');
select ok(not exists (select 1 from auth.users where id = 'b2b2b2b2-0000-4000-8000-000000000002')
          and not exists (select 1 from public.consents where user_id = 'b2b2b2b2-0000-4000-8000-000000000002')
          and not exists (select 1 from public.auth_accounts where user_id = 'b2b2b2b2-0000-4000-8000-000000000002'),
  'the user, their account and their data are gone');
select is((select count(*)::int from public.auth_email_outbox where template = 'deletion_completed' and to_email = 'v3-b@example.test'), 1,
  'the "deleted" email is queued');
select is((select count(*)::int from public.auth_apple_revocations where refresh_token_enc = 'v1.fake.ciphertext'), 1, 'the Apple token revocation is queued');
select ok((select completed_at is not null from public.auth_deletion_requests where user_id = 'b2b2b2b2-0000-4000-8000-000000000002'),
  'a minimal record (ids and dates, no email) remains');
insert into auth.users (id, email) values ('d4d4d4d4-0000-4000-8000-000000000004', 'v3-b@example.test');
select lives_ok(
  $$insert into public.auth_accounts (user_id, email, method, status, confirmed_at, pepper_version)
    values ('d4d4d4d4-0000-4000-8000-000000000004', 'v3-b@example.test', 'PASSWORD', 'UNCONFIRMED', null, 1)$$,
  'after deletion the email can be used for a new account');

-- Deleting auth.users must reach every user table. Only these three keep rows on purpose
-- (deletion record, the queued "deleted" email, short-lived permits); housekeeping purges them.
select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                        and k.confdeltype = 'c' and a.attnum = any(k.conkey))),
  array['auth_deletion_requests', 'auth_email_outbox', 'auth_permits'],
  'every other user table cascades from auth.users, so the day-30 job erases it');

select * from finish();
rollback;
