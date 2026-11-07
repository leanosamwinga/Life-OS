-- Sign-in v3 (docs/sign-in-spec.md, docs/sign-in-supabase-mapping.md).
--
-- Supabase Auth keeps users, password hashes and sessions. Everything the spec adds on top —
-- one method per email, pauses, codes, reset links, devices, tickets, nonces, deletion — lives
-- here, in tables that ONLY the server touches (the auth-api edge function connects with the
-- database role; the Supabase Auth server reads a few through its hooks). App users never read
-- these tables directly: RLS is on, there are no policies for anon/authenticated, and all
-- privileges are revoked from them.
--
-- Defence in depth for "methods are never linked automatically" (spec 0.1, 9.3):
--   1. Apple and Google are switched OFF in Supabase Auth itself (config.toml), so its
--      automatic identity linking can never run. auth-api verifies Apple/Google ID tokens itself
--      and keeps them in public.auth_federated_identities, matched by (provider, sub) only.
--   2. Sign-ups are switched off; auth-api creates users with the admin API (service key), and
--      the before-user-created hook below refuses every other way of creating a user.
--   3. A trigger on auth.identities refuses any identity other than one 'email' identity per user.
--   4. The custom-access-token hook refuses to issue a token for a fresh sign-in that auth-api
--      didn't permit, so nobody can skip auth-api's checks by calling Supabase Auth directly.
--   5. A trigger on auth.users refuses password changes auth-api didn't permit.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Trimmed, lower-cased email (spec 1.1). Dots and +tags are kept.
create or replace function public.normalise_email(email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(email))
$$;

-- Server-only table boilerplate: RLS on, nothing for anon/authenticated, all for service_role.
create or replace function public.lock_down_server_table(t regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('revoke all on table %s from anon, authenticated, public', t);
  execute format('grant all on table %s to service_role', t);
end;
$$;
revoke all on function public.lock_down_server_table(regclass) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accounts: one row per Supabase Auth user, holding the sign-in method (spec 1.1, 1.2)
-- ---------------------------------------------------------------------------

create table public.auth_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  email_norm text not null generated always as (public.normalise_email(email)) stored,
  method text not null check (method in ('PASSWORD', 'APPLE', 'GOOGLE')),
  status text not null default 'ACTIVE' check (status in ('UNCONFIRMED', 'ACTIVE', 'PENDING_DELETION')),
  is_private_relay boolean not null default false,
  step_up_required boolean not null default false,
  step_up_set_at timestamptz,
  confirmed_at timestamptz,
  password_changed_at timestamptz,
  -- Which server pepper the Supabase Auth password was derived with (spec 5.4, rotation).
  pepper_version integer,
  email_deliverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_accounts_password_pepper check ((method = 'PASSWORD') = (pepper_version is not null)),
  constraint auth_accounts_confirmed check (status = 'UNCONFIRMED' or confirmed_at is not null)
);
-- One account per email, whatever the method (spec 0.1). DELETED accounts are hard-deleted.
create unique index auth_accounts_email_norm_key on public.auth_accounts (email_norm);
create index auth_accounts_unconfirmed_idx on public.auth_accounts (created_at) where status = 'UNCONFIRMED';

-- Apple / Google identities, matched by (provider, sub) only, never by email (spec 1.1, 9.3).
create table public.auth_federated_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  provider text not null check (provider in ('APPLE', 'GOOGLE')),
  subject text not null,
  email_at_provider text,
  is_private_relay boolean not null default false,
  -- Apple refresh token, AES-GCM encrypted with a key only auth-api holds (spec 9.2).
  apple_refresh_token_enc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, subject),
  -- One sign-in method per account, so at most one federated identity.
  unique (user_id)
);

-- Known devices (spec 1.1). device_id is a random 128-bit value kept on the device; only its
-- SHA-256 is stored. Location is a town, never an IP (spec 8.4).
create table public.auth_known_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  device_id_hash text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  label text not null,
  coarse_location text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id_hash)
);

-- Per-session details Supabase Auth doesn't keep (device list S-4). Goes when the session goes.
create table public.auth_session_meta (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  device_id_hash text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  label text not null,
  coarse_location text,
  -- Push token for this session's device; removed with the session (spec 8.3).
  push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_session_meta_user_idx on public.auth_session_meta (user_id);

-- Every refresh token auth-api has handed out, hashed. Supabase Auth deliberately lets the
-- previous refresh token be replayed once ("fail-to-save", not configurable), but the spec says
-- any reuse revokes the session (8.1). auth-api checks here first: a superseded hash → the whole
-- session is revoked and auth.refresh.reuse is logged.
create table public.auth_refresh_hashes (
  token_hash text primary key,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  issued_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_refresh_hashes_session_idx on public.auth_refresh_hashes (session_id);

-- ---------------------------------------------------------------------------
-- Wrong-password pauses and the quiet account-wide check (spec 4.1, 4.2)
-- ---------------------------------------------------------------------------

-- Every WRONG_PASSWORD, keyed by (device, email) and (IP, email). user_id is null when the
-- email has no account (the pause still applies, so it can run before the look-up).
create table public.auth_sign_in_failures (
  id bigint generated always as identity primary key,
  email_norm text not null,
  key_kind text not null check (key_kind in ('device', 'ip')),
  key_hash text not null,
  user_id uuid references public.auth_accounts (user_id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index auth_sign_in_failures_key_idx on public.auth_sign_in_failures (email_norm, key_kind, key_hash, failed_at);
create index auth_sign_in_failures_user_idx on public.auth_sign_in_failures (user_id, failed_at);

create table public.auth_sign_in_pauses (
  email_norm text not null,
  key_kind text not null check (key_kind in ('device', 'ip')),
  key_hash text not null,
  -- 1 = 15 minutes, doubling each time, capped at 24 hours.
  level integer not null default 1 check (level >= 1),
  paused_until timestamptz not null,
  last_failure_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email_norm, key_kind, key_hash)
);

-- Pause length for a level: 15, 30, 60, 120 … minutes, capped at 24 hours.
create or replace function public.auth_pause_interval(level integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select least(interval '15 minutes' * power(2, greatest(level, 1) - 1), interval '24 hours')
$$;

-- Records one wrong password for each key and returns the longest pause now in force for this
-- email from these keys (null = not paused). A pause starts on the 5th wrong try in 15 minutes
-- on a key; if failures continue after a pause the next one doubles; 24 hours without failures
-- resets the level. Never touches the account itself (no lock-out).
create or replace function public.auth_record_wrong_password(
  p_email_norm text,
  p_user_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_now timestamptz default now()
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  k record;
  recent integer;
  existing public.auth_sign_in_pauses%rowtype;
  next_level integer;
  result timestamptz;
begin
  for k in select * from (values ('device', p_device_hash), ('ip', p_ip_hash)) as v(kind, hash) where v.hash is not null loop
    insert into public.auth_sign_in_failures (email_norm, key_kind, key_hash, user_id, failed_at)
    values (p_email_norm, k.kind, k.hash, p_user_id, p_now);

    select * into existing from public.auth_sign_in_pauses
     where email_norm = p_email_norm and key_kind = k.kind and key_hash = k.hash
     for update;

    -- 24 hours without failures on this key resets the ladder.
    if existing.email_norm is not null and existing.last_failure_at < p_now - interval '24 hours' then
      delete from public.auth_sign_in_pauses
       where email_norm = p_email_norm and key_kind = k.kind and key_hash = k.hash;
      existing := null;
    end if;

    select count(*) into recent from public.auth_sign_in_failures
     where email_norm = p_email_norm and key_kind = k.kind and key_hash = k.hash
       and failed_at > p_now - interval '15 minutes'
       and (existing.paused_until is null or failed_at > existing.paused_until);

    if recent >= 5 then
      next_level := coalesce(existing.level, 0) + 1;
      insert into public.auth_sign_in_pauses (email_norm, key_kind, key_hash, level, paused_until, last_failure_at)
      values (p_email_norm, k.kind, k.hash, next_level, p_now + public.auth_pause_interval(next_level), p_now)
      on conflict (email_norm, key_kind, key_hash) do update
        set level = excluded.level, paused_until = excluded.paused_until, last_failure_at = excluded.last_failure_at;
    elsif existing.email_norm is not null then
      update public.auth_sign_in_pauses set last_failure_at = p_now
       where email_norm = p_email_norm and key_kind = k.kind and key_hash = k.hash;
    end if;
  end loop;

  -- The quiet account-wide check (spec 4.2): >= 20 wrong passwords in 24 hours from >= 3
  -- different devices or IPs sets step_up_required. Nothing else happens.
  if p_user_id is not null then
    update public.auth_accounts a
       set step_up_required = true, step_up_set_at = p_now
     where a.user_id = p_user_id
       and not a.step_up_required
       and (select count(*) from public.auth_sign_in_failures f
             where f.user_id = p_user_id and f.key_kind = 'device' and f.failed_at > p_now - interval '24 hours') >= 20
       and (select count(distinct (f.key_kind, f.key_hash)) from public.auth_sign_in_failures f
             where f.user_id = p_user_id and f.failed_at > p_now - interval '24 hours') >= 3;
  end if;

  select public.auth_active_pause(p_email_norm, p_device_hash, p_ip_hash, p_now) into result;
  return result;
end;
$$;

-- Longest pause in force for this email from either key, or null.
create or replace function public.auth_active_pause(
  p_email_norm text,
  p_device_hash text,
  p_ip_hash text,
  p_now timestamptz default now()
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(paused_until) from public.auth_sign_in_pauses
   where email_norm = p_email_norm
     and ((key_kind = 'device' and key_hash = p_device_hash) or (key_kind = 'ip' and key_hash = p_ip_hash))
     and paused_until > p_now
$$;

-- ---------------------------------------------------------------------------
-- Look-up and send limits (spec 4.1): one table of timestamped events per (bucket, key).
-- Buckets: lookup:device, lookup:ip, lookup:email, resend, reset:email, reset:device, nonce,
-- breach-range. Counted only when a button is tapped.
-- ---------------------------------------------------------------------------

create table public.auth_rate_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  at timestamptz not null default now()
);
create index auth_rate_events_idx on public.auth_rate_events (bucket, key_hash, at);

-- ---------------------------------------------------------------------------
-- One-time codes, reset links, nonces, tickets, re-auth tokens, permits (spec 1.1, 4.1)
-- ---------------------------------------------------------------------------

-- 6-digit codes, stored only as HMAC-SHA256 under a server key.
create table public.auth_one_time_codes (
  id uuid primary key default gen_random_uuid(), -- = challenge_id
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  purpose text not null check (purpose in ('CONFIRM_EMAIL', 'NEW_DEVICE')),
  code_hmac text not null,
  device_id_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_one_time_codes_user_idx on public.auth_one_time_codes (user_id, purpose, created_at);

-- Reset links: 256 random bits; only the SHA-256 is stored.
create table public.auth_reset_tokens (
  token_hash text primary key,
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_reset_tokens_user_idx on public.auth_reset_tokens (user_id);

-- Nonces for Apple and Google ID tokens: single use, 10 minutes, bound to the device.
create table public.auth_nonces (
  id uuid primary key default gen_random_uuid(),
  -- ID_TOKEN: Apple/Google sign-in. APP_ATTEST: the one-time challenge for an attestation.
  purpose text not null default 'ID_TOKEN' check (purpose in ('ID_TOKEN', 'APP_ATTEST')),
  nonce_hash text not null unique,
  device_id_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One-tap tickets for 0b-8h / 0b-8i: 2 minutes, single use, bound to the device.
create table public.auth_tickets (
  ticket_hash text primary key,
  kind text not null check (kind in ('SIGN_IN_EXISTING', 'CREATE_FEDERATED')),
  provider text not null check (provider in ('APPLE', 'GOOGLE')),
  subject text not null,
  email text,
  is_private_relay boolean not null default false,
  given_name text,
  apple_refresh_token_enc text,
  device_id_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-auth tokens for deletion (S-5b/5c): 5 minutes, single use, bound to the session.
create table public.auth_reauth_tokens (
  token_hash text primary key,
  user_id uuid not null references public.auth_accounts (user_id) on delete cascade,
  session_id uuid not null,
  scope text not null check (scope in ('DELETE_ACCOUNT')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Short-lived permits auth-api writes just before it asks Supabase Auth to do something.
-- The hooks/triggers below consume them, so Supabase Auth refuses the same action when it
-- comes from anywhere else.
create table public.auth_permits (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('ISSUE_SESSION', 'REFRESH_SESSION', 'SET_PASSWORD')),
  user_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_permits_lookup_idx on public.auth_permits (purpose, user_id) where used_at is null;

-- ---------------------------------------------------------------------------
-- Owner alerts, outbox, deletion, Apple webhook events, breach dataset
-- ---------------------------------------------------------------------------

-- "Someone tried to sign up with your email": at most one per account per 24 hours (spec 4.1).
create table public.auth_owner_alerts (
  user_id uuid primary key references public.auth_accounts (user_id) on delete cascade,
  last_sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every email goes through here so sending never adds time (spec 6.3). params can hold a
-- code or a reset link until the row is sent; the sender clears params and to_email then.
create table public.auth_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  to_email text,
  template text not null check (template in (
    'confirm_code', 'new_device_code', 'reset_link', 'reset_uses_provider', 'owner_alert',
    'password_changed', 'deletion_requested', 'deletion_cancelled', 'deletion_completed')),
  params jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  send_after timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_email_outbox_due_idx on public.auth_email_outbox (send_after) where sent_at is null and failed_at is null;

-- Deletion requests (S-5). No FK to the account: the record outlives it (spec 11 keeps a
-- minimal record — ids and dates, no email — for 12 months).
create table public.auth_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null,
  source text not null default 'user' check (source in ('user', 'apple_account_delete')),
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index auth_deletion_requests_open_key on public.auth_deletion_requests (user_id)
  where cancelled_at is null and completed_at is null;

-- Apple token revocations queued by the day-30 job and done by auth-api (needs our Apple key).
create table public.auth_apple_revocations (
  id uuid primary key default gen_random_uuid(),
  refresh_token_enc text not null,
  attempts integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- App Attest keys, one per app install (spec 6.2): the public key from the attestation and the
-- last assertion counter (each assertion must increase it).
create table public.auth_app_attest_keys (
  key_id text primary key,
  device_id_hash text not null,
  public_key_spki text not null,
  counter bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Apple server-to-server notifications already handled (idempotency, spec 9.4).
create table public.auth_apple_events (
  event_key text primary key,
  event_type text not null,
  subject text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Breached-password hashes (spec 5.3): SHA-1, split into the 5-character range prefix and the
-- 35-character suffix, upper-case hex. Locally this holds a tiny FAKE fixture
-- (supabase/fixtures/breached-passwords.sql); before launch it is loaded from the Pwned
-- Passwords dataset (see docs/SPEC-QUESTIONS.md).
create table public.auth_breached_hashes (
  prefix text not null check (prefix ~ '^[0-9A-F]{5}$'),
  suffix text not null check (suffix ~ '^[0-9A-F]{35}$'),
  breach_count integer not null default 1,
  primary key (prefix, suffix)
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'auth_accounts', 'auth_federated_identities', 'auth_known_devices', 'auth_session_meta',
    'auth_sign_in_failures', 'auth_sign_in_pauses', 'auth_rate_events', 'auth_one_time_codes',
    'auth_reset_tokens', 'auth_nonces', 'auth_tickets', 'auth_reauth_tokens', 'auth_permits',
    'auth_owner_alerts', 'auth_email_outbox', 'auth_deletion_requests', 'auth_apple_revocations',
    'auth_apple_events', 'auth_breached_hashes', 'auth_app_attest_keys', 'auth_refresh_hashes'
  ] loop
    perform public.lock_down_server_table(format('public.%I', t)::regclass);
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t and column_name = 'updated_at') then
      execute format(
        'create trigger set_updated_at before update on public.%I
           for each row execute function public.set_updated_at()', t);
    end if;
  end loop;
end;
$$;

revoke all on function public.auth_record_wrong_password(text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.auth_active_pause(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.auth_record_wrong_password(text, uuid, text, text, timestamptz) to service_role;
grant execute on function public.auth_active_pause(text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Consume a permit (used by the hooks and triggers). Returns true if one was used.
-- ---------------------------------------------------------------------------

create or replace function public.auth_consume_permit(p_purpose text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.auth_permits
   where purpose = p_purpose and user_id = p_user_id and used_at is null and expires_at > now()
   order by created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return false;
  end if;
  update public.auth_permits set used_at = now() where id = v_id;
  return true;
end;
$$;
revoke all on function public.auth_consume_permit(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Auth hooks (registered in config.toml [auth.hook.*])
-- ---------------------------------------------------------------------------

-- Before User Created: Supabase Auth runs this on every PUBLIC way of creating a user (sign-up,
-- OTP, OAuth/ID token, anonymous, invite). Life OS never creates users that way: auth-api uses
-- the admin API (service key only, which doesn't run this hook — supabase/auth v2.197.0
-- internal/api/hooks.go callers). So any call that reaches here is refused.
create or replace function public.auth_before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Accounts are created through Life OS sign-in only.'));
end;
$$;

-- Custom Access Token: a fresh sign-in needs an ISSUE_SESSION permit from auth-api; a refresh
-- needs a REFRESH_SESSION permit, the account to still exist and the session to be inside its lifetime (spec 8.1:
-- phone idle 30 days / absolute 90 days, web idle 7 days / absolute 30 days). Adds
-- lifeos_scope (FULL / PENDING_DELETION).
create or replace function public.auth_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_method text := event ->> 'authentication_method';
  v_claims jsonb := event -> 'claims';
  v_session uuid := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  v_status text;
  v_meta public.auth_session_meta%rowtype;
  v_idle interval;
  v_absolute interval;
begin
  select status into v_status from public.auth_accounts where user_id = v_user;
  if v_status is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Sign in through Life OS.'));
  end if;
  if v_method is distinct from 'token_refresh' then
    if not public.auth_consume_permit('ISSUE_SESSION', v_user) then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'Sign in through Life OS.'));
    end if;
  else
    -- Refreshes go through auth-api too (strict reuse detection, see auth_refresh_hashes).
    if not public.auth_consume_permit('REFRESH_SESSION', v_user) then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'Refresh through Life OS.'));
    end if;
    select * into v_meta from public.auth_session_meta where session_id = v_session;
    if found then
      v_idle := case when v_meta.platform = 'web' then interval '7 days' else interval '30 days' end;
      v_absolute := case when v_meta.platform = 'web' then interval '30 days' else interval '90 days' end;
      if now() > v_meta.created_at + v_absolute or now() > v_meta.updated_at + v_idle then
        return jsonb_build_object('error', jsonb_build_object(
          'http_code', 401, 'message', 'Session expired.'));
      end if;
      -- updated_at doubles as "last used" (the set_updated_at trigger sets it).
      update public.auth_session_meta set label = label where session_id = v_session;
    end if;
  end if;
  if v_status = 'UNCONFIRMED' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Confirm your email first.'));
  end if;
  v_claims := jsonb_set(v_claims, '{lifeos_scope}',
    to_jsonb(case when v_status = 'PENDING_DELETION' then 'PENDING_DELETION' else 'FULL' end));
  return jsonb_build_object('claims', v_claims);
end;
$$;

-- Send Email: Supabase Auth never sends email for Life OS. Every email (codes, reset links,
-- alerts) is ours, from the outbox, with spec section 7 copy and no sign-in links.
create or replace function public.auth_send_email_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.auth_before_user_created_hook(jsonb)',
    'public.auth_custom_access_token_hook(jsonb)',
    'public.auth_send_email_hook(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
      execute format('grant execute on function %s to supabase_auth_admin', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guards on Supabase Auth's own tables
-- ---------------------------------------------------------------------------

-- Only ever one identity per user, and only 'email'. Apple/Google live in our table.
create or replace function public.auth_identities_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider <> 'email' then
    raise exception 'Life OS: % identities are not stored in Supabase Auth', new.provider
      using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.identities i where i.user_id = new.user_id and i.id <> new.id) then
    raise exception 'Life OS: one sign-in method per account' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger auth_identities_guard
  before insert or update of provider, user_id on auth.identities
  for each row execute function public.auth_identities_guard();

-- A password can only be set or changed by auth-api (it writes a SET_PASSWORD permit first),
-- so breach checks, the pepper and "sign out other devices" always apply. Email changes are
-- not offered yet (spec 11 "later"), so they are refused outright.
create or replace function public.auth_users_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(new.encrypted_password, '') <> ''
     and not public.auth_consume_permit('SET_PASSWORD', new.id) then
    raise exception 'Life OS: passwords are changed through Life OS only' using errcode = 'P0001';
  end if;
  if coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change then
    raise exception 'Life OS: email changes are not available yet' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger auth_users_guard
  before update of encrypted_password, email_change on auth.users
  for each row execute function public.auth_users_guard();

revoke all on function public.auth_identities_guard() from public, anon, authenticated;
revoke all on function public.auth_users_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data API (PostgREST): sign-out takes effect at once, and a PENDING_DELETION session can't
-- use the Data API at all (spec 8.1, 8.3). Supabase documents both the session_id check
-- against auth.sessions and pgrst.db_pre_request (see the mapping doc).
-- ---------------------------------------------------------------------------

create or replace function public.check_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_session uuid;
begin
  if v_claims is null or v_claims ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  v_session := nullif(v_claims ->> 'session_id', '')::uuid;
  if v_session is null or not exists (select 1 from auth.sessions s where s.id = v_session) then
    raise sqlstate 'PGRST' using
      message = json_build_object('code', 'SESSION_REVOKED', 'message', 'Session revoked')::text,
      detail = json_build_object('status', 401, 'headers', json_build_object())::text;
  end if;
  -- Check the account itself too, so a token issued just before "Delete account" can't keep
  -- using the Data API until it expires.
  if v_claims ->> 'lifeos_scope' is distinct from 'FULL'
     or exists (select 1 from public.auth_accounts a
                 where a.user_id = (v_claims ->> 'sub')::uuid and a.status = 'PENDING_DELETION') then
    raise sqlstate 'PGRST' using
      message = json_build_object('code', 'PENDING_DELETION', 'message', 'Account pending deletion')::text,
      detail = json_build_object('status', 403, 'headers', json_build_object())::text;
  end if;
end;
$$;
revoke all on function public.check_request() from public;
-- PostgREST runs it as the request's role, so both API roles need it (it returns at once for anon).
grant execute on function public.check_request() to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.check_request';
    notify pgrst, 'reload config';
  end if;
end;
$$;
