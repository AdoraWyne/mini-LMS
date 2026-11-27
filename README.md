# Mini LMS: consultation booking

A small learning-management app where students book, reschedule, cancel and complete consultations, and admins
see every consultation in the system (read-only).

**Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres, Auth, `supabase-js`, `@supabase/ssr`) ·
TanStack Query · zod 4 · shadcn/ui · Vitest. Started from the `with-supabase` template.

**Contents:** [Setup](#setup) · [Try it](#try-it-as-a-reviewer) · [Implementation](#implementation-summary) ·
[Security model](#security-model) · [Decisions](#decisions-and-justifications) · [Assumptions](#assumptions) ·
[Testing](#testing) · [With more time](#what-id-do-with-more-time)

---

## Setup

### Prerequisites

- **Node 24** (pinned in `.tool-versions`; `asdf install` or `mise install` picks it up)
- **Docker** running (the Supabase CLI runs Postgres, Auth etc. locally in containers)

### Run the app

```bash
npm install
npx supabase start        # first run downloads the images; prints URLs and keys
cp .env.example .env.local
```

Fill in `.env.local` from `npx supabase status -o env`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321          # API_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...  # PUBLISHABLE_KEY
```

```bash
npm run dev               # http://localhost:3000
```

`npx supabase start` applies the migration in `supabase/migrations/` automatically. To start from a clean database
later: `npx supabase db reset` (this deletes all local data, including accounts).

### Accounts

1. Sign up at <http://localhost:3000/auth/sign-up> with any email (e.g. `student@test.com`).
2. No confirmation email locally (Supabase's local default): you're logged in and sent to the dashboard straight
   away. Log out before creating the next account.
3. Every new account is a **student**. Nobody can sign up as an admin.

### Making an admin

Admins are made by hand. In **Supabase Studio** (<http://127.0.0.1:54323>) → **SQL Editor**:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'admin@test.com');
```

The admin sees an **Admin** link in the header after the next page load.

### Run the tests

```bash
cp .env.test.example .env.test.local
# set SUPABASE_SERVICE_ROLE_KEY to the value printed by:
npx supabase status -o env | grep '^SERVICE_ROLE_KEY='

npm run dev               # in another terminal: the API tests send real HTTP requests to the app
npm run check             # tsc + ESLint + all tests; exit code 0 = everything passed
```

Unit and DB tests also run without the app (`npm test -- tests/unit tests/db`). Tests only ever run against local
Supabase: a guard refuses any non-localhost URL.

---

## Try it (as a reviewer)

1. Sign up two students and one admin (see [Accounts](#accounts) and [Making an admin](#making-an-admin)).
2. As a student: **Book consultation** → fill in the form → you're back on the dashboard with "Booked".
3. Reschedule or cancel an upcoming booking from its row.
4. **Testing "complete":** a consultation can only be completed after its time has passed, and the app (and the
   database) only accept bookings in the future. To try it, move one into the past in Studio's SQL Editor:
   ```sql
   update public.consultations set scheduled_at = now() - interval '1 hour'
   where id = '<consultation id>';   -- or: where reason = '<the reason you typed>'
   ```
   Studio runs as the `postgres` role, which the business rules deliberately don't restrict (so operators can fix
   data). Reload the dashboard: the badge says "Awaiting completion" and the checkbox is enabled.
5. As the admin: **Admin** in the header → every consultation, paginated, read-only.

A full manual checklist (including DevTools and direct-database attacks) is in
[`docs/test-plan.md`](docs/test-plan.md). The acceptance criteria are in
[`docs/user-journeys.md`](docs/user-journeys.md).

---

## Implementation summary

**Starting point:** the `with-supabase` template. I removed its demo pages (`/protected`, the hero, the tutorial) and
pointed the auth redirects (login, sign-up, password update) at `/dashboard`.

### Architecture

```
Browser (React, TanStack Query)
   │  fetch("/api/...")  only our API, never Supabase tables (lib/client/api-client.ts)
   ▼
Next.js route handlers (app/api/**)          auth check, zod validation, business rules, status codes
   │  supabase-js with the USER's session (never the service-role key)
   ▼
Postgres (Supabase)                          grants + RLS + business-rule trigger
```

The Supabase URL and publishable key ship to every browser, so anyone can skip our API and call the database's
REST API directly. That's why the database enforces the rules **on its own** (see [Security model](#security-model)),
and the API repeats them to give friendly errors.

### Data model (`supabase/migrations/20261126121155_init.sql`)

| Table           | Columns                                                                                                                                                                                    | Notes                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `profiles`      | `id` (→ `auth.users`), `role` (`student` \| `admin`, default `student`), `created_at`                                                                                                      | Created by a trigger on sign-up. Roles live here, not in user metadata (which users can edit).                          |
| `consultations` | `id`, `student_id` (→ `auth.users`), `first_name`, `last_name`, `reason`, `scheduled_at` (`timestamptz`), `status` (`scheduled` \| `completed` \| `cancelled`), `created_at`, `updated_at` | Length checks on trimmed text. Indexes match the sort order: `(student_id, scheduled_at, id)` and `(scheduled_at, id)`. |

Generated TypeScript types: `lib/database.types.ts` (`npm run db:types` after a migration).

### API

| Method  | Route                                      | Who       | Does                                                                            |
| ------- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------- |
| `GET`   | `/api/consultations`                       | logged in | My consultations, oldest first                                                  |
| `POST`  | `/api/consultations`                       | logged in | Book. The owner always comes from the session                                   |
| `PATCH` | `/api/consultations/[id]`                  | owner     | One action: `complete`, `uncomplete`, `cancel`, or `reschedule` + `scheduledAt` |
| `GET`   | `/api/admin/consultations?page=&pageSize=` | admin     | Everything, paginated (default 20, max 100)                                     |

- **One envelope:** success `{ data }`, error `{ error: { message, details? } }`. camelCase in the API, snake_case
  in the database, converted in one mapper.
- **Status codes, checked in this order:** `401` not logged in → `403` wrong role → `400` invalid input (a malformed
  path id is a `404`) → `404` not found **or not yours** (never `403`, so the API doesn't reveal that a row exists)
  → `409` not allowed in the current state or time. Unexpected errors → `500` with a generic message.

### State rules (one `status` column)

| Action     | Allowed when                                                                 |
| ---------- | ---------------------------------------------------------------------------- |
| Complete   | `scheduled` and the time has passed                                          |
| Uncomplete | `completed` (an undo for a mistaken tick)                                    |
| Cancel     | `scheduled` and still upcoming (soft cancel: the row is kept)                |
| Reschedule | `scheduled`, still upcoming, and the new time is in the future and different |

The same table lives in three places, kept in sync: `lib/api/transitions.ts` (the API's UPDATE `WHERE` clause),
the database trigger, and `lib/consultations/display.ts` (what the UI shows). The UI version only decides what to
display; if it's wrong, the API still answers `409`.

### Folder layout

```
app/api/**                 route handlers (thin: auth → validate → one query → respond)
app/(app)/**               logged-in pages: dashboard, booking form, admin
lib/api/                   server side of the API: schemas (zod, shared with the browser), auth, errors,
                           mappers, transitions, response helpers
lib/client/                browser side: the API client, URL helpers
lib/consultations/         pure UI rules: status labels, available actions, date conversion
hooks/                     TanStack Query hooks (data fetching lives here, not in components)
components/                presentation; tables and forms take data as props
supabase/migrations/       the schema, RLS, grants and triggers
tests/{unit,db,api}/       see Testing
```

---

## Security model

Three layers in the database, each answering a different question. Each was proven by tests that call Supabase
directly as real users (`tests/db/security.test.ts`).

| Layer       | Question                                       | Examples                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grants**  | Which actions and columns may this role touch? | Logged-out (`anon`): nothing. Logged-in: read both tables; insert only the booking fields; update only `status` and `scheduled_at`; **no delete** anywhere. `profiles` is read-only, so nobody can change their own role. |
| **RLS**     | Which rows?                                    | Your own consultations; admins can **read** all. Admins have no update policy, so the admin view is read-only even at the database level.                                                                                 |
| **Trigger** | Which state changes?                           | The rules table above, with the database clock. Raises `LM400` (bad input) or `LM409` (not allowed now), which the API maps to `400` / `409`.                                                                             |

On top of that, in the app:

- **The session is verified on every request** with `getClaims()`, which checks the JWT signature. A tampered cookie
  (e.g. someone editing the user id inside it) gets a `401`; a test proves it.
- **The service-role key never appears in app code.** It's only used by test setup, read from a gitignored file,
  created in one file behind a localhost guard, and an ESLint rule stops any app file from importing it.
- **Strict validation:** unknown keys in a request body are a `400`, so a client can't slip in `studentId` or `status`.
- **Fixed an open redirect in the template:** the starter's email-confirm route redirected to any `?next=` URL, so a
  real confirmation link could send users to another site. It now only accepts same-site paths (including the `/\`
  bypass), with unit tests.

---

## Decisions and justifications

| Topic                        | Decision                                                                                      | Why                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where roles live             | `public.profiles` table with a `role` enum                                                    | User metadata is editable by the user. A table is visible in migrations and protected by grants and RLS.                                                                                                                           |
| Who enforces security        | The API **and** the database                                                                  | The publishable key gives browsers a direct door to the database, so it can't rely on the API.                                                                                                                                     |
| Supabase client in the API   | The user's session client                                                                     | RLS then applies to every query. The service-role key would bypass it.                                                                                                                                                             |
| New users                    | A trigger creates a `student` profile; it never reads sign-up metadata                        | Nobody can sign up as an admin.                                                                                                                                                                                                    |
| Making admins                | Manual SQL                                                                                    | An admin-management UI is out of scope.                                                                                                                                                                                            |
| Cancel                       | Soft cancel (`status = 'cancelled'`)                                                          | Keeps history; cancelled rows stay visible with a badge.                                                                                                                                                                           |
| Completion                   | One `status` enum, no `is_completed` flag                                                     | Invalid combinations (cancelled **and** completed) can't exist.                                                                                                                                                                    |
| Completion is a toggle       | Complete ⇄ uncomplete                                                                         | The brief says "complete/incomplete", and it's the only way to undo a mistaken tick (admins are read-only).                                                                                                                        |
| "Awaiting completion"        | A UI-only label for `scheduled` + past                                                        | "Scheduled" would be misleading for a past time. Derived, not stored, so no cron job.                                                                                                                                              |
| API style                    | REST route handlers, not Server Actions                                                       | One explicit HTTP contract, testable directly (as the brief prefers).                                                                                                                                                              |
| PATCH body                   | Action-based (`{ action: "cancel" }`, …)                                                      | Each action is one transition with one rule, instead of a generic "update any field".                                                                                                                                              |
| Atomic updates               | The rules are in the UPDATE's `WHERE` clause                                                  | No check-then-update race. Two simultaneous cancels give exactly one `200` and one `409` (tested).                                                                                                                                 |
| Telling `404` from `409`     | If the UPDATE changes 0 rows, look the row up **filtered to the caller**                      | Yours but not allowed → `409`; anything else → `404`, so other users' rows never leak.                                                                                                                                             |
| Clocks                       | The API uses the server clock; the trigger re-checks with the database clock                  | PostgREST filters can't call `now()`. At the exact boundary the trigger wins, with a `409`/`400`, never a `500`.                                                                                                                   |
| Validation                   | zod 4 strict objects in every route; text trimmed before length checks                        | Runtime validation and mass-assignment protection. The booking form runs the **same** schema in the browser, so client and server rules can't drift.                                                                               |
| Dates                        | `timestamptz` (UTC); the browser converts with `toISOString()`; shown with `toLocaleString()` | One unambiguous moment; each viewer sees their own timezone. No Temporal API (not in Safari yet).                                                                                                                                  |
| Auth check on the server     | `getClaims()`, never `getSession()`                                                           | It verifies the JWT signature. Trade-off: a revoked token stays valid until it expires; `getUser()` would catch that at the cost of a network call per request.                                                                    |
| `/api` in the proxy          | The proxy refreshes the session but doesn't redirect `/api/*`                                 | Pages get login redirects, APIs get `401` JSON. A redirect would make `fetch` silently load the login page's HTML.                                                                                                                 |
| UI data fetching             | TanStack Query, calling only our API                                                          | All rules in one place; cache invalidated after every mutation, success or error.                                                                                                                                                  |
| Admin booking                | Allowed                                                                                       | Admin = everything a student can do + a read-only view of all.                                                                                                                                                                     |
| Admin pagination             | Offset (`page`, `pageSize`), sorted `scheduled_at, id`; past the end → `200` with no items    | Simple and standard; `id` keeps pages stable when times are equal.                                                                                                                                                                 |
| Admin page for non-admins    | The 404 page, served with HTTP **200**                                                        | With `cacheComponents`, the role check runs inside `<Suspense>`; once streaming starts the status is fixed. It's a UX gate only: the data is protected by the API (`403`) and RLS. A real `404` would need the check in the proxy. |
| `on delete cascade`          | On `student_id`                                                                               | Deleting an account removes that person's data (privacy). Soft cancel is a different case.                                                                                                                                         |
| Migrations                   | One migration, edited during development                                                      | Nothing was deployed or shared, so a single readable schema file is clearer. In a shared project I'd add new migrations instead.                                                                                                   |
| Error codes from the trigger | Custom SQLSTATE `LM400` / `LM409`                                                             | A stable contract instead of matching message text. (PostgREST's `PT` codes were considered; they'd tie the database to PostgREST.)                                                                                                |

---

## Assumptions

- A **consultation** is a booked time slot with a reason. There are no tutors or availability; any future time can
  be booked.
- **First and last name are entered on each booking** (as the brief lists them), not taken from the account.
- A student can have **several bookings**, even at the same time. Double-booking prevention isn't required.
- **Cancelled bookings are final.** They can't be rescheduled or un-cancelled.
- **A booking whose time has passed** can only be completed (or left "Awaiting completion"). It can't be cancelled or
  rescheduled, because it already happened.
- Times are shown in the **viewer's** timezone. Everyone looking at a booking sees the same moment.
- **Admins are trusted operators,** made by hand. The admin view only needs to show bookings; there's no admin
  editing.

---

## Testing

**272 automated tests**, all against the **real local Supabase**. Nothing is mocked: mocking Supabase would remove
exactly the grants, RLS and triggers under test.

| Layer                | Tests | What                                                                                                                                                      | How                                                       |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Unit (`tests/unit/`) | 138   | zod schemas, row mapper, error → status mapping, state transitions, UI rules, date conversion, redirect check                                             | Test-first (red → green → refactor)                       |
| DB (`tests/db/`)     | 47    | Grants, RLS and the trigger, by calling Supabase directly as real users with the publishable key                                                          | Written **after** the migration, to lock in its behaviour |
| API (`tests/api/`)   | 87    | All 4 routes over real HTTP with real session cookies: status-code order, every action in every state, ownership, concurrency, forged cookies, pagination | Test-first                                                |

Worth knowing:

- **Tests were checked against deliberately broken code** (e.g. swapping `getClaims()` for `getSession()`, removing
  a filter, an off-by-one in pagination) to make sure they fail when they should.
- **Date tests run in `Australia/Sydney`** (set by `npm test`). In UTC, local time and UTC look the same, so a
  conversion bug would pass unnoticed. A guard fails the file if it's run in another timezone.
- **Test data is isolated:** each run creates throwaway users (`test-<runId>-<n>@example.test`) and deletes them
  (cascade removes their data). The admin tests check invariants, not exact counts, so your manual data never breaks
  them. Test files run one after another, so pagination checks can't be affected by another file's inserts.
- **No component or end-to-end tests** (time). The UI's rules live in pure, unit-tested functions; the UI itself was
  checked by hand with [`docs/test-plan.md`](docs/test-plan.md).

### Manual verification

Run by hand with [`docs/test-plan.md`](docs/test-plan.md) in Chrome, with two students and one admin.

- **Sections 0-8 passed:** setup, auth and page access, API status codes vs. redirects, the dashboard list, row
  actions, the booking form, the admin page, timezones, and calling our API directly from the DevTools Console. The
  one exception is the optional screen-reader check (4.11, VoiceOver), which was skipped.
- **Sections 9 and 10 were not run (time).** These are the direct Supabase REST calls (curl as Student A) and a few
  extra checks (open redirect, lint rule, leftover test users). Most of what they check is also covered by automated
  tests:
  - Section 9 (grants, RLS, the business-rule trigger, when the API is bypassed): the DB tests in `tests/db/` call
    Supabase directly as real users with the publishable key, which is the same door.
  - 10.1 (open redirect): `tests/unit/safe-next-path.test.ts`.
  - 10.2 (lint rule) and 10.4 (leftover test users) have no automated test. They're quick to run by hand.

Running the plan turned up a few behaviours worth knowing (none of them bugs; the plan was corrected where its steps
were wrong):

- **No confirmation email locally.** Local Supabase has `enable_confirmations: false`, so a new user is confirmed and
  logged in at sign-up. The sign-up form goes to `/dashboard` when `signUp()` returns a session, and to the "check your
  email" page when it doesn't, so it also works with confirmations on (as they should be in production).
- **Check constraints apply even in Studio.** Studio runs as `postgres`, which skips RLS, grants and the trigger, but
  not the length checks: a seed with an 1,119-character reason was refused.
- **If Supabase is down, pages redirect to login.** The proxy can't verify the session, so it treats the user as
  logged out. This fails safe (nobody gets in unverified), at the cost of a confusing screen during an outage. The
  dashboard's error/retry state was tested by blocking the API request in DevTools instead.
- **Unknown `/api/*` paths return Next.js's HTML 404,** not our JSON error shape (no route handler matches). The status
  code is right; a catch-all route returning JSON is an easy addition.
- **A 409 from a row changed in another tab is real but hard to see.** The list refreshes after every mutation, the
  row comes back cancelled with no actions, and the dialog showing the message is removed with it. See "page-level
  toast" below.

---

## What I'd do with more time

- **Cypress end-to-end tests and component tests** (with MSW for the API), to automate the manual test plan.
- **Postgres functions (RPC) for every write,** so the rules and the clock live in one place in the database instead
  of in both the API and the trigger.
- A **tutor role** with availability, and **double-booking prevention**.
- **Admin role management** in the UI, with an **audit log**.
- **Rate limiting** on the API.
- **Temporal** for recurring bookings, once Safari supports it.
- A **page-level toast** for errors from rows whose controls disappear (e.g. a booking cancelled in another tab while
  its dialog was open).
- Make the UI more UX friendly.
