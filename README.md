# Life OS

One calm, minimal place for health, money, plans, extracurriculars and reflection. iOS first, then web, then Android. UK only: £, metric, Europe/London time.

This repo is an npm workspaces monorepo:

| Path                 | What                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| `apps/mobile`        | Expo (SDK 58) + Expo Router app — tabs: Today, Health, Week, Money, Me            |
| `packages/core`      | Pure TypeScript: domain types, nutrition maths, UK formatting. No I/O             |
| `supabase/`          | `config.toml`, `migrations/`, `functions/` (Edge Functions), `seed.sql`, `tests/` |
| `scripts/`           | `test-db.sh` + a Supabase shim for running database tests on plain Postgres       |
| `.github/workflows/` | CI: install, lint, typecheck, tests                                               |

See [`CLAUDE.md`](./CLAUDE.md) for product context, domain rules, conventions and the phase plan.

## Prerequisites

- Node 22 (see `.nvmrc`) and npm 10+
- For the backend: [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker
- For iOS: Xcode + Simulator, or Expo Go on a device

## Setup

```bash
npm install

# App env (optional — without it the app starts with a "Not connected" banner and sample data)
cp apps/mobile/.env.example apps/mobile/.env.local

# Backend env (optional, for Sign in with Apple locally)
cp supabase/.env.example supabase/.env
```

### Run the backend locally

```bash
supabase start            # Postgres, Auth, Storage, Edge runtime in Docker
supabase db reset         # apply migrations + seed.sql
supabase functions serve food-lookup
```

`supabase start` prints the API URL and anon key — put them in `apps/mobile/.env.local` as
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

When creating the hosted project, choose a **UK/EU region (London, `eu-west-2`)** — the Privacy Policy promises UK/EU storage.

### Run the app

```bash
npm run mobile            # expo start; press i for the iOS simulator
```

## Scripts (from the repo root)

| Command                                | What it does                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `npm run lint`                         | ESLint across the repo                                                      |
| `npm run format`                       | Prettier write (`format:check` to verify)                                   |
| `npm run typecheck`                    | `tsc -b` for core + edge functions, `tsc --noEmit` for the app              |
| `npm test`                             | core (Vitest) + edge functions (Vitest) + mobile (jest-expo)                |
| `npm run test:core`                    | core unit tests only                                                        |
| `npm run test:functions`               | edge function mapping/handler tests                                         |
| `npm run test:mobile`                  | app smoke tests                                                             |
| `npm run test:db`                      | database RLS tests (see below)                                              |
| `npm run gen:types -w @life-os/mobile` | regenerate `apps/mobile/src/lib/database.types.ts` (needs `supabase start`) |

### Database tests

`supabase/tests/*.test.sql` are pgTAP tests proving owner-only access, the global food cache rules and health-data consent.

- With Docker: `supabase start && supabase test db`
- Without Docker: point `DATABASE_URL` at an empty Postgres 15+ database with pgTAP installed and run `npm run test:db`. It loads `scripts/db/supabase-shim.sql` (roles, `auth.users`, `auth.uid()`), applies the migrations, then runs every test file. CI uses this path.

## Licences

Food data from Open Food Facts, available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
