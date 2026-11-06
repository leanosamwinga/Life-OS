-- Life OS — Phase 2A: sign-in and first-run onboarding
--
--   * user_settings records the onboarding choices (wireframes 0d–0g). Apple Health and
--     Screen Time permission requests arrive in phase 3; for now we only remember the choice.
--   * Screen Time data itself is never read, stored or synced — only whether the user wants
--     the on-device card. There is deliberately no column for any Screen Time value.
--   * New users get a first name from Apple/Google sign-in metadata when it is provided.

alter table public.user_settings
  -- 0d Apple Health: 'connect' = wants it (permission sheet arrives in phase 3), 'not_now' = skipped.
  add column apple_health_choice text check (apple_health_choice in ('connect', 'not_now')),
  -- 0e Screen Time: 'show' = wants the on-device card (phase 3), 'not_now' = skipped.
  add column screen_time_choice text check (screen_time_choice in ('show', 'not_now')),
  -- 0f: when the app last asked the OS/browser for notification permission.
  add column notifications_prompted_at timestamptz,
  -- 0g: set when the user taps "Go to Today". Until then the app shows onboarding.
  add column onboarding_completed_at timestamptz;

comment on column public.user_settings.screen_time_choice is
  'Only the user''s choice. Screen Time data is shown on-device by Apple and never read, stored or synced.';

-- First name for the profile: explicit display_name, else what Apple/Google sent.
create or replace function public.first_name_from_metadata(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce(
    nullif(btrim(meta ->> 'display_name'), ''),
    nullif(btrim(meta ->> 'given_name'), ''),
    nullif(split_part(btrim(meta ->> 'full_name'), ' ', 1), ''),
    nullif(split_part(btrim(meta ->> 'name'), ' ', 1), '')
  )), 80), '');
$$;

revoke all on function public.first_name_from_metadata(jsonb) from public, anon;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public.first_name_from_metadata(coalesce(new.raw_user_meta_data, '{}'::jsonb)));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;
