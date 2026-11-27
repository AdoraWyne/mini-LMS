# CLAUDE.md: Contour mini-LMS take-home

## The brief (summary; full brief in docs/brief.md if present)

Mini-LMS: Next.js (App Router) + TypeScript + Supabase (supabase-js, @supabase/ssr, Postgres).

- Auth: sign up / login / logout (from the `with-supabase` template).
- Student dashboard: list own consultations, mark complete/incomplete, book (first name, last name,
  reason, datetime), reschedule, cancel.
- Admin (role "admin"): read-only list of all consultations.
- README (setup, assumptions/justifications, implementation summary) + DB migrations + schema.
- **Prefer API route handlers over Server Actions** (template's existing actions are fine).
- Graded on: implementation, scalability, best practice, **security**, **consistency of choices**.
- **Acceptance criteria:** `docs/user-journeys.md`. Every route and page must satisfy it, and the automated tests (see Testing) are named after its journeys.

## Decisions (final, don't change without asking)

| #   | Topic                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why (short)                                                                                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Where roles live         | `public.profiles` table, `role` enum (`student`, `admin`)                                                                                                                                                                                                                                                                                                                                                                                        | `user_metadata` is user-editable; a table is visible in migrations and easy to extend                                                                              |
| 2   | Who enforces security    | **Both** API checks and RLS                                                                                                                                                                                                                                                                                                                                                                                                                      | Supabase URL + publishable key ship to the browser, so the DB has a public door that bypasses the API                                                              |
| 3   | Supabase client in API   | The user's session client (`lib/supabase/server.ts`), typed with `Database`. Never use the service-role key in app code. It's allowed only in `tests/` (helpers and test files) for setup, cleanup and verification reads against local Supabase, and the client is created only in `tests/helpers/admin-client.ts`. Enforced by a lint rule and a localhost guard. Assertions about user behaviour always use the publishable key as real users | Service role bypasses RLS                                                                                                                                          |
| 4   | New user role            | DB trigger on `auth.users` insert creates a profile with role `student` (column default)                                                                                                                                                                                                                                                                                                                                                         | Nobody can sign up as admin; trigger never reads sign-up metadata                                                                                                  |
| 4a  | Making an admin          | Manual SQL `update` in Studio, documented in README                                                                                                                                                                                                                                                                                                                                                                                              | Out of scope to build an admin UI                                                                                                                                  |
| 5   | Cancel                   | Soft cancel: `status = 'cancelled'`, row kept                                                                                                                                                                                                                                                                                                                                                                                                    | Keeps history                                                                                                                                                      |
| 6   | Completion               | **One** `status` enum: `scheduled` / `completed` / `cancelled`. No `is_completed` column                                                                                                                                                                                                                                                                                                                                                         | Invalid states (cancelled + completed) are unrepresentable                                                                                                         |
| 6a  | Time rules               | **Complete**: only `scheduled` AND time has passed. **Uncomplete**: only `completed`. **Cancel / reschedule**: only `scheduled` AND in the future; new time must be in the future                                                                                                                                                                                                                                                                | Business rules I chose                                                                                                                                             |
| 6b  | Complete UI              | Checkbox disabled with a hint ("Available after the consultation time") until the time passes                                                                                                                                                                                                                                                                                                                                                    | Brief needs a visible toggle                                                                                                                                       |
| 6c  | Status badge             | UI-only label: `scheduled` + time passed → "Awaiting completion". DB status unchanged                                                                                                                                                                                                                                                                                                                                                            | Tells the student the next step; "Scheduled" for a past time would be misleading                                                                                   |
| 6d  | Cancelled on dashboard   | Shown with a "Cancelled" badge, no actions                                                                                                                                                                                                                                                                                                                                                                                                       | Consistent with soft cancel (history is visible)                                                                                                                   |
| 7   | API style                | REST route handlers                                                                                                                                                                                                                                                                                                                                                                                                                              | One explicit HTTP contract, testable directly                                                                                                                      |
| 8   | Validation               | zod 4 in every route that takes input, `z.strictObject()` (rejects unknown keys). Text fields use `.trim()` before `min`/`max`, so whitespace-only values return 400 and saved values are trimmed                                                                                                                                                                                                                                                | Runtime validation; strict objects = strong params / mass-assignment protection                                                                                    |
| 9   | PATCH body               | **Action-based** discriminated union: `{action:"complete"}`, `{action:"uncomplete"}`, `{action:"cancel"}`, `{action:"reschedule", scheduledAt}`                                                                                                                                                                                                                                                                                                  | Each action = one state transition with one rule                                                                                                                   |
| 9a  | Atomic updates           | Put the "allowed when" conditions **in the UPDATE's WHERE clause** (no check-then-update). Time conditions use the Next.js server clock (PostgREST filters can't call `now()`); the trigger re-checks with the DB clock, so a boundary disagreement is a 409/400, never a 500                                                                                                                                                                    | Avoids races                                                                                                                                                       |
| 10  | Dates                    | `timestamptz` (UTC). Browser converts `datetime-local` with `new Date(v).toISOString()`. Display with `toLocaleString()`. zod: `z.iso.datetime({ offset: true })`. **No Temporal API**                                                                                                                                                                                                                                                           | One unambiguous moment; viewer sees their own tz. Temporal not in Safari yet                                                                                       |
| 11  | UI data fetching         | TanStack Query, calling **only our API routes** (never Supabase tables from the UI)                                                                                                                                                                                                                                                                                                                                                              | All rules in one place                                                                                                                                             |
| 12  | `on delete cascade`      | Keep it on `student_id`                                                                                                                                                                                                                                                                                                                                                                                                                          | Deleting an account removes personal data (privacy). Soft cancel is a different case. Note in README                                                               |
| 13  | Auth check on server     | `supabase.auth.getClaims()` (what the template uses). **Never `getSession()` on the server**                                                                                                                                                                                                                                                                                                                                                     | Verifies the JWT signature. Trade-off: revoked tokens stay valid until expiry; `getUser()` would catch that. Note in README                                        |
| 14  | `proxy.ts` and `/api/*`  | Template's proxy redirects logged-out requests to `/auth/login`, including `/api/*`. **Skip the redirect for paths starting with `/api`** (keep the session refresh). Route handlers return their own 401                                                                                                                                                                                                                                        | Pages get redirects, APIs get status codes                                                                                                                         |
| 15  | Admin booking            | Allowed. Admin = everything a student can do + read-only view of all                                                                                                                                                                                                                                                                                                                                                                             | Role hierarchy; no extra code. Note in README                                                                                                                      |
| 16  | Admin pagination         | Offset (`?page=&pageSize=`), default 20, max 100 (zod → 400). Sort `scheduled_at asc, id asc`                                                                                                                                                                                                                                                                                                                                                    | Simple and standard for admin tables; `id` tiebreaker keeps pages stable. Cursor pagination at large scale (README)                                                |
| 17  | Business rules in the DB | Least-privilege grants (`anon`: nothing; `authenticated`: SELECT both tables, INSERT/UPDATE only listed `consultations` columns, no DELETE) + a BEFORE INSERT/UPDATE trigger enforcing decision 6a. `updated_at` set by its own trigger, never sent by the API                                                                                                                                                                                   | RLS only checks ownership; without this a student could skip the API and break rules on their own rows. Postgres functions (RPC) for all writes = "with more time" |

## Status codes (every route, checks in this order)

1. Not logged in → **401**
2. Wrong role (admin route) → **403**
3. Invalid input → **400**. Checked before any query.
   - Body: invalid JSON, unknown keys, unknown action, missing/invalid fields, a new `scheduledAt` that isn't in the future (book or reschedule).
   - Query params: e.g. admin `page` / `pageSize` out of range.
   - Exception: a path `id` that isn't a UUID → **404** (it's the address, not input). Check with `z.uuid()` before querying, so Postgres never throws a 500.
   - Within step 3, the path id is checked first (→ 404), then the body (→ 400).
4. Row not found or not yours → **404** (never 403, so we don't reveal that the row exists)
5. Valid request but not allowed in the current state/time (e.g. cancel a completed one) → **409**

Rule of thumb: problem in what you sent → 400. Problem with the resource's current state → 409.

**PATCH: telling 404 from 409.** The UPDATE has the rules in its WHERE clause (decision 9a). If it updates 0 rows, run a follow-up
`select id where id = ? and student_id = <me>`: a row comes back → **409**, nothing → **404**.
Always filter by `student_id = <me>`: admins can SELECT every row, so without the filter an admin would get 409 instead of 404.
The PATCH route only ever deals with the caller's own rows, whoever they are.

Unexpected DB error → **500** with a generic message (no internal details). Unsupported method (e.g. DELETE) → **405** (Next.js default).

One error shape for the whole API: `{ error: { message, details? } }`. Success: `{ data: ... }`.
API speaks camelCase; DB speaks snake_case. Convert in one helper.

## Routes

| Method | Route                      | Who       | Does                                                                                                              |
| ------ | -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/consultations`       | Logged in | List my consultations (`scheduled_at asc, id asc`)                                                                |
| POST   | `/api/consultations`       | Logged in | Book. `student_id` always from the session, never the body                                                        |
| PATCH  | `/api/consultations/[id]`  | Owner     | Action-based update (decision 9)                                                                                  |
| GET    | `/api/admin/consultations` | Admin     | List all (paginated): `{ data: { items, page, pageSize, total, totalPages } }`; past the end → 200, empty `items` |

## Database (one migration in `supabase/migrations/`)

- Enums: `app_role ('student','admin')`, `consultation_status ('scheduled','completed','cancelled')`.
- `profiles(id uuid pk → auth.users on delete cascade, role app_role not null default 'student', created_at)`.
- `consultations(id uuid pk default gen_random_uuid(), student_id uuid not null default auth.uid() → auth.users on delete cascade, first_name/last_name text check `char_length(btrim(col)) between 1 and 100`, reason text check `char_length(btrim(reason)) between 1 and 1000`, scheduled_at timestamptz not null, status consultation_status not null default 'scheduled', created_at, updated_at)`.
- Indexes: `(student_id, scheduled_at, id)` and `(scheduled_at, id)`. They match the `scheduled_at asc, id asc` sort; the first also covers the `student_id` FK.
- Trigger `on_auth_user_created` → `handle_new_user()` (`security definer set search_path = ''`), inserts `profiles(id)` only.
- `is_admin()` SQL function, `stable`, `security definer set search_path = ''`, checks `profiles` for `auth.uid()`.
  Execute revoked from `public`/`anon`, granted to `authenticated` only.
- RLS enabled on both tables. Policies `to authenticated`, use `(select auth.uid())`:
  - profiles: SELECT own row only. **No insert/update/delete policies** (nobody changes their role).
  - consultations SELECT: own rows OR `is_admin()`.
  - consultations INSERT: `with check (student_id = (select auth.uid()))`.
  - consultations UPDATE: own rows that are not cancelled (`using`), still own (`with check`). **No admin update policy** (read-only).
  - **No DELETE policy.**
- Grants (decision 17). Supabase grants **all** privileges on new `public` tables to `anon` and `authenticated` by default,
  so start from nothing and add back only what's needed:
  - `revoke all on public.profiles, public.consultations from anon, authenticated;`
  - profiles: `grant select` to `authenticated`. Nothing else.
  - consultations, to `authenticated`: `grant select`; `grant insert (student_id, first_name, last_name, reason, scheduled_at)`;
    `grant update (status, scheduled_at)`.
  - No DELETE or TRUNCATE on either table (TRUNCATE ignores RLS). `anon` gets nothing.
  - `id`, `created_at`, `updated_at` come from defaults/triggers. Names, reason, `student_id`, `created_at` can't change after booking.
  - Privileges are checked **before** RLS: a missing grant → permission error (`42501`); an allowed action on a row RLS hides → 0 rows, no error.
- `updated_at` trigger: `BEFORE UPDATE` sets `new.updated_at = now()`. A trigger can write a column the user has no grant on.
  **The API never sends `updated_at`** (it would get a permission error).
- Business-rule trigger (decision 17): `BEFORE INSERT OR UPDATE` on `consultations`, using the DB clock `now()`:
  - Enforced only when `current_user = 'authenticated'` (every app user, via our API or direct Supabase calls).
    Other roles (e.g. `postgres` in Studio or seed scripts) are allowed, so operators can fix data and set up test cases.
    The trigger function must NOT be `security definer`, otherwise `current_user` would be the function owner.
  - INSERT: `status` must be `scheduled` and `scheduled_at > now()`.
  - UPDATE: only these transitions are allowed (same table as decision 6a):
    - scheduled → completed: only if `old.scheduled_at <= now()`
    - completed → scheduled (uncomplete): always
    - scheduled → cancelled: only if `old.scheduled_at > now()`
    - scheduled → scheduled with a new `scheduled_at` (reschedule): old and new times both `> now()`, and the new time must differ from the old (an unchanged time raises `LM400`)
    - complete, uncomplete and cancel must keep `new.scheduled_at = old.scheduled_at`. Only reschedule may change the time.
    - anything else → raise an exception
  - Custom SQLSTATE codes, so the API maps trigger rejections to 400/409, never 500:
    - `LM400`: problem in what was sent (new time not in the future, reschedule to the same time, time changed during a status change, insert not `scheduled`) → **400**
    - `LM409`: transition not allowed in the current state/time → **409**
  - No CHECK constraints with `now()` (old rows would fail later, e.g. on a restore).
- Split of responsibility: **RLS = ownership + roles. API = business rules with friendly errors (zod + WHERE).
  Trigger = the same business rules as a backstop for every door, including direct Supabase calls.**
  Keep the API WHERE rules and the trigger in sync with the decision 6a table.

## Pages

- `/auth/*`: from the template.
- `/dashboard`: my consultations (client component, TanStack Query). Actions per row follow decision 6a.
- `/dashboard/new`: booking form (4 fields; `min` = now on the datetime input; server still validates).
- `/admin`: server component checks the role and calls `notFound()` for non-admins (UX only; the real
  protection is the API 403 + RLS), then renders the read-only table.
- UI: shadcn/ui (the template already has it). Styling isn't graded; don't over-polish.

### UI rules

- **Reschedule:** shadcn `Dialog` with a `datetime-local` input, pre-filled with the current `scheduledAt` converted to
  the viewer's local time, `min` = now.
- **Cancel:** shadcn `AlertDialog` confirmation.
- **Complete (6b):** checkbox disabled with the hint "Available after the consultation time" until the time passes.
- **Badges (6c, 6d):** `scheduled` + time passed → "Awaiting completion". Cancelled rows: "Cancelled" badge, no actions.
- **Booking form (journeys section 2):** character counter on each text field (e.g. 87/100), field errors from
  `error.details.fieldErrors` next to each field, `error.message` at the top.
- **After booking:** redirect to `/dashboard` with a short "Booked" message.
- **Admin pagination:** Previous / Next buttons + "Page X of Y", disabled at the ends.
- **Header:** a link to `/admin` shown only to admins (UX only; the API 403 + RLS are the real protection).
- **Mutations:** action buttons disabled while a request is pending; invalidate the list query after every mutation
  (success or error), so the UI always shows the server's true state.

## Reject these if you're about to do them

- Using the service-role key anywhere outside `tests/`. **The only exception:** test setup, cleanup and verification reads, where all of
  these hold: the key lives in gitignored `.env.test.local` as `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_`), the client is
  created only in `tests/helpers/admin-client.ts` (behind the localhost guard), and it's imported only from test helpers and
  test files. Never for assertions about what a user can do, never in app code.
- `getSession()` on the server.
- Reading `student_id` (or any ownership field) from the request body.
- Writing a Server Action instead of an API route.
- Reading roles from `user_metadata`.
- Changing the migration/schema to get rid of a type error.

## Testing

TDD (red → green → refactor) from step 5 on. Test names come from `docs/user-journeys.md`.

| Layer | Tool                                    | Covers                                                                         | When                                                    |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Unit  | Vitest                                  | zod schemas, row mapper, error → status mapping (`LM400`, `LM409`, `42501`, …) | Test-first                                              |
| DB    | Vitest + supabase-js as real test users | RLS, grants, triggers (journeys section 7)                                     | After the fact (migration came first; say so in README) |
| API   | Vitest + real HTTP to the running app   | 4 routes, status-code order (journeys sections 2-6)                            | Test-first                                              |

- Tests run against the **real local Supabase**. Never mock Supabase or the API (that would remove RLS/grants/triggers, the things under test).
- No MSW, no Playwright, no component tests (time). Mention in README "with more time".
- Service-role key: `SUPABASE_SERVICE_ROLE_KEY` in gitignored `.env.test.local` (template: `.env.test.example`), never in `.env.local`,
  never `NEXT_PUBLIC_`. Only `tests/helpers/admin-client.ts` creates the client (`admin`, setup, cleanup and verification reads only); assertions use
  `asStudent()` / `asAdmin()` / `asAnon()`. ESLint `no-restricted-imports` blocks `tests/` imports everywhere except `tests/**`.
- Test users: `test-<runId>-<n>@example.test`. Leftovers: `delete from auth.users where email like 'test-%@example.test';`
- Run: `npm test` (needs `npx supabase start`; API tests also need `npm run dev`, or `TEST_BASE_URL`). Unit and DB tests run without the app.
- API tests authenticate with real session cookies (`tests/helpers/http.ts`: `@supabase/ssr` + in-memory cookie jar) and never follow redirects.

## Build order

1. ✅ Setup: template (`npx create-next-app --example with-supabase`), `npx supabase init` + `start`,
   `.env.local` from `.env.example`, install `zod @tanstack/react-query`, check sign up/login/logout.
2. ✅ Migration + make myself admin.
3. ✅ Fix `proxy.ts` for `/api/*` (decision 14).
4. ✅ Test setup: Vitest, test users helper, DB tests for RLS/grants/triggers (from the smoke test).
5. ✅ API, test-first, in sub-steps (one commit each):
   - 5a. DB types (`npm run db:types` → `lib/database.types.ts`, committed) + `lib/api/` helpers: `schemas.ts` (zod),
     `mappers.ts` (row → camelCase DTO), `errors.ts` (`ApiError`, DB error → status), `http.ts` (`{ data }` / `{ error }` responses).
   - 5b. `lib/api/auth.ts` (`requireUser` / `requireAdmin`) + GET/POST `/api/consultations`.
   - 5c. PATCH `/api/consultations/[id]`.
   - 5d. GET `/api/admin/consultations`.
6. ✅ UI: providers, hooks, dashboard, booking form, admin page.
7. Manual checks (two students + admin, DevTools `fetch` calls, Studio checks) for anything not automated. Record results for the README.
8. README.

## Open items (ask me when we get there)

- Testing "complete": bookings must be in the future, so the README tells reviewers to edit `scheduled_at`
  to a past time in Studio (runs as `postgres`, so RLS, grants and the business-rule trigger don't apply).
  Optional: a seed script doing the same. Ask me before adding one.
- README "what I'd do with more time": Playwright E2E + component tests (MSW), tutor role + availability,
  double-booking prevention, admin role management + audit log, rate limiting, Temporal for recurring bookings,
  page-level toast for errors from rows whose controls disappear.
