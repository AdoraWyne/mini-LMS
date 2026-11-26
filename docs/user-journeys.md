# User journeys

Written as Given / When / Then, based on the decisions in `CLAUDE.md`.
All open questions have been decided. See [Decisions](#decisions-from-open-questions) at the bottom.

**Actors used below**

- **Student A** / **Student B**: two normal users (role `student`, the default on sign-up).
- **Admin**: a user whose `profiles.role` was set to `admin` by hand in Studio.
- **Logged-out visitor**: no session.
- "Now" depends on where the rule is checked:
  - **New time must be in the future** (book, reschedule): checked by zod in the API route, using the Next.js server clock (`Date.now()`).
  - **Rules about the existing consultation's time** (complete, cancel, reschedule): checked in the UPDATE's WHERE clause (decision 9a), also using the **Next.js server clock**. supabase-js/PostgREST filters only take literal values, so the WHERE clause can't call the database's `now()`.
  - **Backstop:** the business-rule trigger re-checks every rule with the **database clock** (`now()`).
  - Both clocks are synced in practice, so they agree to within milliseconds. If they disagree right at the boundary, the trigger rejects the update (`LM409` → **409**, or `LM400` → **400**), never a 500.
  - Using the DB clock in the WHERE clause too would need a Postgres function per action (RPC): "with more time" (decision 17).

---

## 1. Auth and page access

- **Given** a logged-out visitor, **when** they sign up with email + password, **then** an account is created and a profile row is created automatically with role `student`.
- **Given** a visitor signing up, **when** they try to send `role: "admin"` in the sign-up metadata, **then** they still become a `student`. The trigger never reads metadata (decision 4).
- **Given** a registered user, **when** they log in, **then** they can reach `/dashboard`.
- **Given** a logged-in user, **when** they log out, **then** their session ends and protected pages redirect them to `/auth/login`.
- **Given** a logged-out visitor, **when** they open `/dashboard`, `/dashboard/new` or `/admin`, **then** they are redirected to `/auth/login`.
- **Given** a logged-out visitor, **when** they call any `/api/*` route, **then** they get **401** JSON, not a redirect (decision 14).
- **Given** a logged-in student, **when** they open `/admin`, **then** they see a 404 page. The page doesn't reveal that an admin area exists.
- **Given** a logged-in admin, **when** they open `/admin`, **then** they see the read-only table of all consultations.

## 2. Book a consultation (POST `/api/consultations`)

### Happy path

- **Given** Student A is on `/dashboard`, **when** they click "Book consultation", **then** they go to `/dashboard/new`.
- **Given** Student A is on `/dashboard/new`, **when** they fill in first name, last name, reason and a future date/time, and submit, **then**:
  - the browser converts the local date/time to a UTC ISO string with an offset (`new Date(v).toISOString()`),
  - the API returns **201** with `{ data: consultation }` in camelCase,
  - the consultation is saved with `status = scheduled` and `student_id` = Student A (taken from the session),
  - Student A is sent back to `/dashboard` and sees the new booking in the list.
- **Given** the booking form, **when** Student A opens the date/time picker, **then** past times are blocked (`min` = now). This is UX only; the server checks again.

### Rejected bookings

- **Given** Student A, **when** they submit with any field missing or empty, **then** **400** with `details` naming the field, and nothing is saved.
- **Given** Student A, **when** first or last name is longer than 100 characters, or the reason is longer than 1000, **then** **400**.
  - UI: show a character counter (e.g. 87/100) on each text field.
- **Given** Student A, **when** they submit a date/time in the past (e.g. they bypass the `min` attribute), **then** **400** (zod: the new time must be in the future; the problem is in what was sent).
- **Given** Student A, **when** the body includes `studentId`, `status`, `id` or any other extra key, **then** **400**. `z.strictObject()` rejects unknown keys, and ownership always comes from the session.
  - UI: the form never sends extra keys, so a normal user never sees this. If it happens, show the API's error.message in a form-level alert.
- **Given** Student A, **when** `scheduledAt` has no offset (e.g. `"2026-12-01T10:00"`), **then** **400**. Without an offset the moment is ambiguous (decision 10).
  - UI: the form always converts with toISOString(), so this only happens via DevTools. Show error.message if it does.
- **Given** any 400 from the booking form, **then** the form shows each field's error from `error.details` next to that field, and a general `error.message` at the top.

## 3. List my consultations (GET `/api/consultations`)

- **Given** Student A has bookings, **when** they open `/dashboard`, **then** they see only their own consultations, ordered by `scheduled_at asc, id asc` (oldest first).
- **Given** Student A and Student B both have bookings, **when** Student A loads the list, **then** none of Student B's bookings appear (RLS: own rows only).
- **Given** Student A has no bookings, **when** they open `/dashboard`, **then** they see an empty state with a link to book.
- **Given** Student A has cancelled bookings, **when** they open `/dashboard`, **then** they're shown with a "Cancelled" badge and no actions (decision 6d).
- **Given** each row in the list, **then** its time is shown in the viewer's own timezone (`toLocaleString()`) and its status as a badge.
- **Given** a consultation is `scheduled` and its time has passed, **then** its badge reads **"Awaiting completion"** instead of "Scheduled". The label is derived in the UI from `status` + `scheduled_at`; the database status is still `scheduled`.
- **Given** an admin, **when** they call GET `/api/consultations`, **then** they get only their _own_ bookings. The full list is on the admin route. Admins can book their own consultations: admin = everything a student can do + read-only view of all (decision 15).

## 4. Manage a consultation (PATCH `/api/consultations/[id]`)

The body is always one action: `complete`, `uncomplete`, `cancel`, or `reschedule` + `scheduledAt` (decision 9).

### Complete

- **Given** Student A's consultation is `scheduled` and its time has passed, **when** they tick the "mark as complete" checkbox, **then** **200** and the status becomes `completed`.
- **Given** Student A's consultation is `scheduled` and in the future, **when** they look at the row, **then** the "mark as complete" checkbox is disabled with the hint "Available after the consultation time" (decision 6b).
- **Given** a future `scheduled` consultation, **when** Student A sends `{action:"complete"}` directly (e.g. DevTools), **then** **409**.
- **Given** a `completed` or `cancelled` consultation, **when** Student A sends `{action:"complete"}`, **then** **409**.

### Uncomplete

- **Given** Student A's consultation is `completed`, **when** they untick the checkbox (e.g. they ticked it by mistake), **then** **200**, the status goes back to `scheduled` and the badge shows "Awaiting completion".
- **Given** a consultation that was just uncompleted, **when** Student A tries to reschedule or cancel it, **then** **409**. Its time has passed, so the only action left is Complete. Uncomplete never makes a consultation bookable again.
- **Given** a `scheduled` or `cancelled` consultation, **when** Student A sends `{action:"uncomplete"}`, **then** **409**.

### Cancel

- **Given** Student A's consultation is `scheduled` and in the **future**, **when** they click "Cancel" (and confirm), **then** **200**, the status becomes `cancelled` and the row is kept (soft cancel, decision 5).
- **Given** a `scheduled` consultation whose time has **passed**, **when** Student A tries to cancel, **then** **409**. You can't cancel something that has already happened. The Cancel button is hidden or disabled for that row.
- **Given** a `completed` or already `cancelled` consultation, **when** Student A tries to cancel, **then** **409**.

### Reschedule

- **Given** Student A's consultation is `scheduled` and in the future, **when** they choose a new future time and save, **then** **200** and `scheduled_at` is updated. The status stays `scheduled`.
- **Given** a `scheduled` consultation whose time has passed, **when** Student A tries to reschedule, **then** **409**.
- **Given** a `completed` or `cancelled` consultation, **when** Student A tries to reschedule, **then** **409**. Cancelled rows are also blocked by RLS.
- **Given** a future `scheduled` consultation, **when** Student A reschedules it to a time in the past, **then** **400** (zod, same rule as booking).
- **Given** a future `scheduled` consultation, **when** Student A reschedules it to the exact same time, **then** **400** ("New consultation time must be different from the current one"; enforced by the trigger, `LM400`).
- **Given** `{action:"reschedule"}` with no `scheduledAt`, **then** **400**.

### Ownership

- **Given** Student B's consultation, **when** Student A sends any PATCH to its id, **then** **404**, not 403, so Student A can't tell the row exists.
- **Given** an id that doesn't exist, **when** Student A sends a PATCH, **then** **404**.
- **Given** an id that isn't a UUID (e.g. `/api/consultations/abc`), **when** Student A sends a PATCH, **then** **404**. The id is checked with `z.uuid()` before any query, so Postgres never throws a 500.
- **Given** an admin, **when** they send a PATCH to any student's consultation, **then** **404**. There is no admin update policy, so admin is read-only. The follow-up select filters by `student_id = <me>`, so it's 404, not 409.

## 5. Admin view (GET `/api/admin/consultations`)

- **Given** the logged-in user is an admin, **when** they open `/admin`, **then** they see every consultation in the system (all students, all statuses), read-only, with student name, reason, time and status.
- **Given** there are more consultations than one page holds, **when** the admin moves between pages, **then** the next page loads. Offset pagination (`?page=&pageSize=`), default 20, max 100, sorted `scheduled_at asc, id asc` (decision 16).
- **Given** an admin, **when** they load a page, **then** the response is `{ data: { items, page, pageSize, total, totalPages } }` (same `{ data }` envelope as every route).
- **Given** an admin, **when** they ask for a page past the end, **then** **200** with empty `items`. The collection exists; that page is just empty.
- **Given** an admin, **when** they send `pageSize=1000`, `page=-1` or an unknown param (e.g. `sort=reason`), **then** **400**.
- **Given** a student, **when** they send bad params to the admin route, **then** **403** (role is checked before input).
- **Given** a logged-in student, **when** they call GET `/api/admin/consultations`, **then** **403**.
- **Given** a logged-out visitor, **when** they call it, **then** **401**.
- **Given** the admin page, **then** there are no edit, cancel or complete controls.

## 6. Error handling (all routes)

- **Given** any error, **then** the body is `{ error: { message, details? } }`. Success is always `{ data: ... }`.
- **Given** a request body that isn't valid JSON, **then** **400**.
- **Given** a body with an invalid field or an unknown key, **then** **400** for the whole request, and nothing is written (see `docs/reasoning-notes.md`).
- **Given** a PATCH with an unknown action (e.g. `{action:"delete"}`), **then** **400**.
- **Given** a DELETE request to any route, **then** **405**. Nothing is ever hard-deleted from the app.
- **Given** an unexpected database error, **then** **500** with a generic message. Internal details aren't sent to the client.
- **Given** a request breaks several rules at once, **then** checks run in this order: 401 → 403 → 400 → 404 → 409 (a non-UUID id returns 404 at the 400 step).
- **Given** any failed action in the UI, **then** the user sees the error message, and the list still shows the server's true state (TanStack Query refetches), except when the failure was caused by the row changing state (e.g. cancelled in another tab). The row then updates to its new status, which explains what happened.

## 7. Security: someone skips our API

The Supabase URL and publishable key ship to the browser, so anyone can call the database's REST API directly (decision 2). These journeys check that the database holds on its own: grants (which actions and columns), RLS (which rows) and the business-rule trigger (which transitions) (decision 17).

Two kinds of "no" from the database:

- **Permission error** (`42501`): the role has no grant for that action or column. Checked first.
- **0 rows, no error**: the action is granted, but RLS hides the row.

### Logged out (`anon`)

- **Given** a logged-out visitor calls Supabase directly, **when** they read or write `consultations` or `profiles`, **then** a **permission error** (no grants for `anon`).

### Reading

- **Given** Student A calls Supabase directly, **when** they select from `consultations`, **then** they only get their own rows.
- **Given** Student A calls Supabase directly, **when** they select from `profiles`, **then** they only get their own profile.

### Inserting

- **Given** Student A calls Supabase directly, **when** they insert a consultation with `student_id` = Student B, **then** RLS rejects it.
- **Given** Student A calls Supabase directly, **when** they insert a booking with `id`, `status`, `created_at` or `updated_at` in the body, **then** a **permission error** (column grants) and nothing is saved.
- **Given** Student A calls Supabase directly, **when** they insert a booking in the past, **then** the trigger raises `LM400` and nothing is saved.
- **Given** Student A calls Supabase directly, **when** they insert into `profiles` (e.g. a second profile with role `admin`), **then** a **permission error**.

### Updating

- **Given** Student A calls Supabase directly, **when** they update Student B's row's `status`, **then** no error is returned, but 0 rows change (RLS hides the row). Check in Studio that B's row is unchanged.
- **Given** the admin calls Supabase directly, **when** they update any student's consultation `status`, **then** no error, but 0 rows change (no admin update policy). Check in Studio.
- **Given** Student A calls Supabase directly, **when** they update their own `profiles.role` to `admin`, **then** a **permission error** (profiles is SELECT only). Check in Studio that the role is still `student`.
- **Given** Student A calls Supabase directly, **when** they update their own row's `reason`, `first_name`, `last_name`, `student_id`, `id`, `created_at` or `updated_at`, **then** a **permission error** and nothing changes.
- **Given** Student A calls Supabase directly, **when** they update their _own_ row to break a business rule (e.g. set `status = completed` on a future booking), **then** the trigger raises `LM409` and nothing changes.
- **Given** Student A calls Supabase directly, **when** they reschedule their own row to a past time, **then** the trigger raises `LM400` and nothing changes.
- **Given** Student A has a `completed` consultation, **when** they call Supabase directly to uncomplete it **and** move `scheduled_at` to next week in the same update, **then** the trigger raises `LM400` (only reschedule may change the time), so the old booking can't become cancellable or reschedulable again.
- **Given** any successful update, **then** `updated_at` is set by the database trigger, not by the caller.

### Deleting

- **Given** Student A (or the admin) calls Supabase directly, **when** they delete any consultation or profile, **then** a **permission error** (no DELETE grant). Check in Studio that the row still exists.

### Operators

- **Given** an operator in Studio (role `postgres`), **when** they set a booking's `scheduled_at` to the past, **then** it succeeds (grants and RLS don't restrict `postgres`, and the trigger only applies to `authenticated`). This is how reviewers test "complete".

## 8. Edge cases

### Time and timezones

- **Given** Student A is in Sydney (UTC+11) and books 10:00 local, **then** the database stores 23:00 UTC the previous day, and Student A sees 10:00.
- **Given** that booking, **when** an admin in London views it, **then** they see it in London time (e.g. 23:00 the previous day). Same moment, different clock.
- **Given** Student A changes their device timezone after booking, **then** the booking shows at the new local time but is still the same moment.
- **Given** Student A picks a local time that doesn't exist because of a daylight-saving jump (e.g. 02:30 when clocks go 02:00 → 03:00), **then** the browser shifts it to a valid moment, and the stored UTC time is unambiguous.
- **Given** Student A's device clock is wrong, **then** the `min` attribute and the disabled checkbox may be wrong in the UI, but the server (the Next.js clock in zod and the UPDATE's WHERE clause, the DB clock in the trigger) still enforces the real rules.
- **Given** a consultation scheduled for exactly "now", **then** it counts as passed: it can be completed and can no longer be cancelled or rescheduled. Complete needs `scheduled_at <= now`; cancel/reschedule need `scheduled_at > now` (same boundary in the API's WHERE clause and in the trigger).
- **Given** the booking form has been open for a long time and the chosen time is now in the past, **when** Student A submits, **then** the server returns **400** and the UI shows the error.
- **Given** a `scheduled` consultation that has passed and wasn't completed (badge: "Awaiting completion"), **then** the only action left is Complete. It can't be cancelled or rescheduled (a side effect of decision 6a).

### Concurrency

- **Given** Student A has the dashboard open in two tabs, **when** they cancel in tab 1 and then reschedule the same booking in tab 2, **then** tab 2 gets **409**, because the condition is checked inside the UPDATE (decision 9a), and the list refreshes.
- **Given** Student A double-clicks "Cancel", **then** the first request succeeds and the second gets **409**. No error is left in a broken state. Ideally the button is disabled while the request runs.
- **Given** a booking's time passes while the dashboard is open, **then** the checkbox stays disabled until the page refetches or re-renders. The server is the source of truth either way.

### Account deletion

- **Given** a student account is deleted (by an operator, in Studio), **then** their profile and all their consultations are deleted too (`on delete cascade`, decision 12).

---

## Decisions (from open questions)

- **Q1.** Booking or rescheduling to a past time → **400** (zod). Rule of thumb: problem in what you sent → 400; problem with the resource's state → 409.
- **Q2.** Cancelled consultations are shown with a "Cancelled" badge and no actions (decision 6d).
- **Q3.** Admins can book. Admin = everything a student can do + read-only view of all (decision 15).
- **Q4.** A non-UUID id → **404**, checked with `z.uuid()` before any query.
- **Q5.** Offset pagination, default 20, max 100 (zod → 400), sorted `scheduled_at asc, id asc` (decision 16).
- **Q6.** Check order: 401 → 403 → 400 → 404 → 409. PATCH tells 404 from 409 with a follow-up select filtered by `student_id = <me>`.
- **Q7.** Least-privilege grants (`anon`: nothing; profiles SELECT only; consultations SELECT + listed insert/update columns, no DELETE) + a BEFORE INSERT/UPDATE trigger enforcing decision 6a for `authenticated` users, with error codes `LM400`/`LM409` (decision 17).
- **Q8.** Text fields are trimmed in zod (whitespace-only → 400) and the DB checks use `btrim`.
