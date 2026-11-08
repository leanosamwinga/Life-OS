-- Sign-in v3 scheduled jobs (decisions 3–4, spec 4.1, 7.7, 11 retention).
--
--   * auth_run_due_deletions — the day-30 deletion: erases the account and all its data
--     (auth.users ON DELETE CASCADE reaches every user table), queues the Apple token
--     revocation and the "Your Life OS account has been deleted" email, and keeps only a
--     minimal record (ids and dates, no email) in auth_deletion_requests.
--   * auth_housekeeping — purges unconfirmed accounts after 7 days and expired codes,
--     tickets, nonces, links, permits and rate-limit rows (spec 11 retention).
--   * auth_kick_jobs — asks auth-api to send queued email and revoke Apple tokens (pg_net).
--
-- pg_cron runs all three when it's available (hosted Supabase: enable pg_cron and pg_net;
-- local: scripts/local-auth preloads pg_cron). CI's plain Postgres has neither, so the
-- schedule is skipped there and the pgTAP tests call the functions directly.

create or replace function public.auth_run_due_deletions(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select d.id, d.user_id, a.email, a.email_deliverable, f.apple_refresh_token_enc
      from public.auth_deletion_requests d
      left join public.auth_accounts a on a.user_id = d.user_id
      left join public.auth_federated_identities f on f.user_id = d.user_id
     where d.cancelled_at is null and d.completed_at is null and d.due_at <= p_now
     order by d.due_at
     for update of d skip locked
  loop
    if r.apple_refresh_token_enc is not null then
      insert into public.auth_apple_revocations (refresh_token_enc) values (r.apple_refresh_token_enc);
    end if;
    if r.email is not null and r.email_deliverable then
      insert into public.auth_email_outbox (user_id, to_email, template, params, idempotency_key)
      values (null, r.email, 'deletion_completed', '{}'::jsonb, 'deletion_completed:' || r.id)
      on conflict (idempotency_key) do nothing;
    end if;
    -- Erases the Supabase Auth user, its sessions and identities, and (by cascade) the account
    -- row, devices, codes and every Life OS table holding user data.
    delete from auth.users where id = r.user_id;
    update public.auth_deletion_requests set completed_at = p_now where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.auth_housekeeping(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unconfirmed accounts: 7 days (spec 1.2).
  delete from auth.users u
   using public.auth_accounts a
   where a.user_id = u.id and a.status = 'UNCONFIRMED' and a.created_at < p_now - interval '7 days';

  -- Codes, tickets, nonces, reset tokens, re-auth tokens and permits: 24 hours after expiry.
  delete from public.auth_one_time_codes where expires_at < p_now - interval '24 hours';
  delete from public.auth_tickets where expires_at < p_now - interval '24 hours';
  delete from public.auth_nonces where expires_at < p_now - interval '24 hours';
  delete from public.auth_reset_tokens where expires_at < p_now - interval '24 hours';
  delete from public.auth_reauth_tokens where expires_at < p_now - interval '24 hours';
  delete from public.auth_permits where expires_at < p_now - interval '1 hour';

  -- Rate-limit and failure windows are at most 24 hours.
  delete from public.auth_rate_events where at < p_now - interval '25 hours';
  delete from public.auth_sign_in_failures where failed_at < p_now - interval '25 hours';
  delete from public.auth_sign_in_pauses where last_failure_at < p_now - interval '25 hours'
                                          and paused_until < p_now;

  -- Sent or failed email rows (already stripped of address and content).
  delete from public.auth_email_outbox where coalesce(sent_at, failed_at) < p_now - interval '7 days';

  -- Known devices unused for 12 months; deletion records after 12 months; Apple events.
  delete from public.auth_known_devices where last_seen_at < p_now - interval '12 months';
  delete from public.auth_deletion_requests where coalesce(completed_at, cancelled_at) < p_now - interval '12 months';
  delete from public.auth_apple_events where received_at < p_now - interval '90 days';
  delete from public.auth_apple_revocations where revoked_at < p_now - interval '30 days';

  -- Supabase Auth leaves timed-out sessions in auth.sessions; drop ours past their lifetime.
  delete from auth.sessions s
   using public.auth_session_meta m
   where m.session_id = s.id
     and (p_now > m.created_at + case when m.platform = 'web' then interval '30 days' else interval '90 days' end
       or p_now > m.updated_at + case when m.platform = 'web' then interval '7 days' else interval '30 days' end);
end;
$$;

-- Asks auth-api to run its job endpoint (send email, revoke Apple tokens). Needs pg_net and two
-- database settings set in the hosted project (never in the repo):
--   alter database postgres set app.auth_jobs_url = 'https://<ref>.supabase.co/functions/v1/auth-api/v1/internal/jobs/run';
--   alter database postgres set app.auth_job_secret = '<AUTH_JOB_SECRET>';
create or replace function public.auth_kick_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := nullif(current_setting('app.auth_jobs_url', true), '');
  v_secret text := nullif(current_setting('app.auth_job_secret', true), '');
begin
  if v_url is null or v_secret is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := jsonb_build_object(''x-job-secret'', $2, ''content-type'', ''application/json''))'
    using v_url, v_secret;
end;
$$;

revoke all on function public.auth_run_due_deletions(timestamptz) from public, anon, authenticated;
revoke all on function public.auth_housekeeping(timestamptz) from public, anon, authenticated;
revoke all on function public.auth_kick_jobs() from public, anon, authenticated;
grant execute on function public.auth_run_due_deletions(timestamptz) to service_role;
grant execute on function public.auth_housekeeping(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_settings where name = 'shared_preload_libraries' and setting like '%pg_cron%')
     and current_database() = coalesce(nullif(current_setting('cron.database_name', true), ''), 'postgres') then
    create extension if not exists pg_cron;
    perform cron.schedule('lifeos-auth-deletions', '17 * * * *', 'select public.auth_run_due_deletions(now())');
    perform cron.schedule('lifeos-auth-housekeeping', '41 * * * *', 'select public.auth_housekeeping(now())');
    perform cron.schedule('lifeos-auth-jobs', '* * * * *', 'select public.auth_kick_jobs()');
  else
    raise notice 'pg_cron not available: auth jobs not scheduled (run them from the API or tests)';
  end if;
end;
$$;
