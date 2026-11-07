-- Roles and schemas the hosted Supabase image creates before Supabase Auth and our
-- migrations run. LOCAL ONLY (scripts/local-auth/start.sh). The password below never
-- leaves this machine's loopback interface and is not used anywhere else.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin noinherit createrole login password 'local-only-auth-admin';
create schema auth authorization supabase_auth_admin;
grant create on database postgres to supabase_auth_admin;
alter role supabase_auth_admin set search_path = 'auth';

create schema extensions;
create extension pgcrypto with schema extensions;
create extension pgtap with schema extensions;
create extension pg_cron;
grant usage on schema extensions, public to anon, authenticated, service_role;
alter database postgres set search_path = "$user", public, extensions;

-- Supabase's default privileges: new tables are granted to the API roles; RLS protects them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- As in Supabase's image (init-scripts/00000000000001-auth-schema.sql): the API roles can use
-- the auth schema, so SECURITY INVOKER functions like save_meal/log_meal can call auth.uid().
grant usage on schema auth to anon, authenticated, service_role;
