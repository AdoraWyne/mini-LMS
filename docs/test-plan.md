# Manual test plan

A checklist to run by hand. The automated suite (`npm run check`) covers the API, the database rules and the
pure helpers. This plan covers what it can't: the real browser UI, real accounts, DevTools, Studio, and calling
Supabase directly the way an attacker would.

Tick each box as you go. Write anything surprising in **Notes** at the bottom; it feeds the README.

**Conventions**

- Run commands from the project root: `contour-mini-lms/`.
- "Console" means the browser's DevTools **Console** tab. "Network" means the DevTools **Network** tab.
- Text in quotes ("Booked") is what the UI should show, word for word.
- **SQL** steps run in Studio's SQL editor: <http://127.0.0.1:54323> → **SQL Editor**. Studio runs as `postgres`,
  so RLS, grants and the business-rule trigger don't apply there. That's how we create past bookings.

---

## 0. Setup

- [ ] **0.1 Start everything** (2 terminals; a 3rd is used in 0.3):
  ```bash
  npx supabase start        # terminal 1 (once)
  npm run dev               # terminal 2, keep running
  ```
- [ ] **0.2 Optional clean slate.** This wipes all local data, including your accounts.
  ```bash
  npx supabase db reset
  ```
- [ ] **0.3 Automated suite passes** (terminal 3, with `npm run dev` running):
  ```bash
  npm run check             # tsc + lint + all tests
  echo $?                   # must print 0
  ```
  Expect `Tests  272 passed` (or more). Always judge by the exit code (`0`), not by the last line of output.
- [ ] **0.4 Create 3 accounts.** For each one, go to <http://localhost:3000/auth/sign-up> and sign up. Use a password
  you'll remember, e.g. `password123`. No confirmation email is sent: local Supabase has
  `enable_confirmations: false` (`supabase/config.jsonc`), so new users are confirmed and logged in at sign-up,
  and you land on `/dashboard`. Log out before creating the next account.
  - `student-a@test.com`
  - `student-b@test.com`
  - `admin@test.com`
- [ ] **0.5 Make the admin** (SQL):
  ```sql
  update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = 'admin@test.com');

  -- check: admin@test.com = admin, the other two = student
  select u.email, p.role from public.profiles p join auth.users u on u.id = p.id order by u.email;
  ```
- [ ] **0.6 Seed bookings in every state for Student A** (SQL). Past bookings can only be created here:
  the app and the trigger refuse them.
  ```sql
  insert into public.consultations (student_id, first_name, last_name, reason, scheduled_at, status)
  select u.id, v.first_name, 'Seed', v.reason, now() + v.offset_time, v.status::public.consultation_status
  from auth.users u,
  (values
    ('Future',    'Future scheduled booking',   interval '2 days',  'scheduled'),
    ('Past',      'Past scheduled booking',     interval '-2 hours', 'scheduled'),
    ('Done',      'Completed booking',          interval '-3 days', 'completed'),
    ('Gone',      'Cancelled booking',          interval '4 days',  'cancelled')
  ) as v(first_name, reason, offset_time, status)
  where u.email = 'student-a@test.com';

  -- and one future booking for Student B
  insert into public.consultations (student_id, first_name, last_name, reason, scheduled_at)
  select id, 'Bee', 'Seed', 'Student B booking', now() + interval '3 days'
  from auth.users where email = 'student-b@test.com';
  ```
- [ ] **0.7 Copy ids you'll need later** (SQL). Keep this result open in a tab:
  ```sql
  select u.email, c.id, c.first_name, c.status, c.scheduled_at
  from public.consultations c join auth.users u on u.id = c.student_id
  order by u.email, c.scheduled_at;
  ```

---

## 1. Auth and page access

- [ ] **1.1 Home, logged out.** Open <http://localhost:3000/> in a private window. You see "Mini LMS",
  "Book and manage your consultations.", and **Log in** / **Sign up** buttons. No template hero, no deploy button.
- [ ] **1.2 Protected pages redirect.** Still logged out, open `/dashboard`, `/dashboard/new`, `/admin`:
  each one lands on `/auth/login`.
- [ ] **1.3 The old demo page is gone.** Log in, then open `/protected`: you get the 404 page.
- [ ] **1.4 Login lands on the dashboard.** Log in as Student A: you land on `/dashboard`.
- [ ] **1.5 Home redirects when logged in.** Open `/`: you're sent to `/dashboard`.
- [ ] **1.6 Header for a student.** Shows "Mini LMS", "My consultations", your email, Logout. **No** "Admin" link.
- [ ] **1.7 Header for the admin.** Log in as `admin@test.com`: the "Admin" link is there.
- [ ] **1.8 Logout.** Click Logout: you're logged out, and `/dashboard` redirects to login again.
- [ ] **1.9 Nobody can sign up as admin.** Sign up a new account (e.g. `sneaky@test.com`), then run (SQL):
  ```sql
  select u.email, p.role from public.profiles p join auth.users u on u.id = p.id where u.email = 'sneaky@test.com';
  ```
  Role is `student`. (The trigger never reads sign-up metadata.)
- [ ] **1.10 No console errors.** On `/`, `/dashboard`, `/dashboard/new` and `/admin`, the Console has no red errors
  (in particular, no "unstable value `new Date()`" error).

## 2. API answers with status codes, not redirects

- [ ] **2.1 Logged out → 401 JSON.** In a terminal:
  ```bash
  curl -i http://localhost:3000/api/consultations
  ```
  `HTTP/1.1 401` and body `{"error":{"message":"Not logged in"}}`. **Not** a 307 redirect.
- [ ] **2.2 Unknown API path isn't redirected either:**
  ```bash
  curl -i http://localhost:3000/api/anything
  ```
  `404`, not `307`.
- [ ] **2.3 Pages still redirect:**
  ```bash
  curl -i http://localhost:3000/dashboard
  ```
  `307` with `location: /auth/login`.

## 3. Dashboard list (log in as Student A)

- [ ] **3.1 Only my bookings.** You see Future, Past, Done, Gone. **Not** "Bee" (Student B's).
- [ ] **3.2 Sorted oldest first** (by date and time).
- [ ] **3.3 Badges** (decisions 6c, 6d):
  - Future → "Scheduled"
  - Past → "Awaiting completion"
  - Done → "Completed"
  - Gone → "Cancelled"
- [ ] **3.4 Times are in your timezone.** Compare a row with `scheduled_at` in Studio (stored in UTC).
- [ ] **3.5 Long reason is clamped.** SQL, then reload:
  ```sql
  update public.consultations set reason = repeat('This is a very long reason. ', 40)
  where first_name = 'Future';
  ```
  The Reason cell shows 2 lines; hovering shows the full text.
- [ ] **3.6 Narrow window.** Make the window narrow: the table scrolls sideways instead of squashing.
- [ ] **3.7 Empty state.** Log in as a brand-new account with no bookings: "No consultations yet." and a
  "Book your first consultation" button.
- [ ] **3.8 Booked notice.** Open `/dashboard?booked=1`: "Booked. Your consultation is in the list below." appears,
  and `?booked=1` disappears from the URL. Refresh: the message doesn't come back. "Dismiss" hides it.
- [ ] **3.9 Error state and retry timing.**
  1. Open Network, filter **Fetch/XHR**, tick **Preserve log**.
  2. In a terminal: `npx supabase stop`
  3. Reload `/dashboard`.
  4. "Loading…" for about 3 seconds, then "Couldn't load your consultations: …" and **Try again**.
  5. Network shows **3** requests to `consultations`, about 1 s and 2 s apart (1 try + 2 retries).
  6. `npx supabase start`, then click **Try again**: the list comes back.

## 4. Row actions (log in as Student A)

- [ ] **4.1 Future booking:** the checkbox is disabled, with the visible text "Available after the consultation time"
  next to it. **Reschedule** and **Cancel** buttons are shown.
- [ ] **4.2 Past booking ("Awaiting completion"):** only the checkbox, enabled. No Reschedule / Cancel.
- [ ] **4.3 Complete.** Tick it: the badge becomes "Completed".
- [ ] **4.4 Uncomplete.** Untick it: the badge goes back to "Awaiting completion". Still no Reschedule / Cancel
  (its time has passed).
- [ ] **4.5 Cancelled booking (Gone):** no checkbox, no buttons.
- [ ] **4.6 Reschedule dialog.**
  1. Click **Reschedule** on Future.
  2. The input shows the booking's **current** time in your timezone.
  3. The picker doesn't allow earlier than now.
  4. **Save** is disabled until you change the time.
  5. Pick a new time, Save: the dialog closes, the row shows the new time and moves to its sorted position.
- [ ] **4.7 Cancel dialog.**
  1. Click **Cancel** on a future booking: "Cancel this consultation?".
  2. "Keep it" closes it and nothing changes.
  3. Open again, click "Cancel consultation": it shows "Cancelling…", then the row becomes "Cancelled" with no controls.
- [ ] **4.8 Pending disables the row.** Network → throttling dropdown ("No throttling") → **Slow 4G**. Tick a
  checkbox or confirm a dialog: the row's controls / the dialog's button stay disabled until the answer arrives.
  Set throttling back to **No throttling**.
- [ ] **4.9 Forced 409 (two tabs).** Create a fresh future booking first (section 5), then:
  1. Open `/dashboard` in **two tabs**.
  2. Tab 1: cancel the booking.
  3. Tab 2 (don't reload): click **Reschedule** on the same row, pick a time, Save.
  4. The dialog shows "Only upcoming scheduled consultations can be rescheduled", then closes as the list
     refreshes, and the row shows "Cancelled". (Expected: see journeys section 6, the "row changed state" exception.)
- [ ] **4.10 Checkbox enables itself when the time passes.** SQL (set a booking 1 minute ahead):
  ```sql
  update public.consultations set scheduled_at = now() + interval '1 minute' where first_name = 'Future';
  ```
  Reload: the checkbox is disabled with the hint. Wait about 1.5 minutes **without reloading**: it becomes enabled
  and the badge says "Awaiting completion" (the page re-checks the time every 30 s).
- [ ] **4.11 Screen reader (optional).** VoiceOver on (**Cmd+F5**), Tab to a disabled checkbox: it reads
  "Mark the consultation on … as completed" followed by the hint. Cmd+F5 again to turn it off.

## 5. Booking form (`/dashboard/new`, as Student A)

Open Network, filter **Fetch/XHR**, tick **Preserve log**. For "no request" checks, nothing named `consultations`
may appear after you click **Book consultation**.

- [ ] **5.1 Happy path.** Fill all 4 fields with a future time, click **Book consultation**: you land on
  `/dashboard`, "Booked" appears, the new row is in the list. Network shows one POST with status **201**.
- [ ] **5.2 All errors at once.** Leave **First name** empty and **no date**, click Book: "Please fix the fields
  below." at the top, "First name is required" **and** "Pick a date and time". No request.
- [ ] **5.3 Only spaces.** First name = 3 spaces, click Book: "First name is required", counter shows 0/100.
  No request.
- [ ] **5.4 Over the limit.** In the Console run `copy("a".repeat(101))`, paste into **Last name**: the counter
  shows **101/100** in red. Click Book: "Last name must be at most 100 characters". No request.
- [ ] **5.5 Counter ignores surrounding spaces.** Type two spaces + `Ada` + two spaces: **3/100**.
- [ ] **5.6 Past time, typed by hand.** The calendar greys out past dates. Click the year part of the field and
  type `2020` (and the rest), fill the other fields, click Book: "Must be in the future". No request.
- [ ] **5.7 Pending / no double booking.** Throttling **Slow 4G**. Fill the form, click Book, then immediately click
  into First name and press **Enter** several times. The button says "Booking…" and stays disabled; Network shows
  **one** POST; the dashboard shows **one** new row. Set throttling back.
- [ ] **5.8 Back link.** "Back to dashboard" goes to `/dashboard`.

## 6. Admin page

- [ ] **6.1 Student is kept out.** As Student A, open `/admin`: the 404 page. In Network, the `admin` document has
  status **200** (expected: the 404 page is streamed; see `docs/reasoning-notes.md`). No "All consultations" heading.
- [ ] **6.2 Admin sees everything.** As `admin@test.com`, open `/admin`: "All consultations",
  "N consultations in total. Read-only.", bookings from **both** students, a **Student** column (8 characters,
  full id on hover), **no** checkboxes or buttons.
- [ ] **6.3 Pagination.** Create 25 extra rows (SQL):
  ```sql
  insert into public.consultations (student_id, first_name, last_name, reason, scheduled_at)
  select (select id from auth.users where email = 'admin@test.com'), 'Page', 'Test ' || n, 'Pagination test',
         now() + (n || ' hours')::interval
  from generate_series(1, 25) as n;
  ```
  Reload `/admin`:
  1. "Page 1 of 2", **Previous** disabled.
  2. **Next** → `?page=2`, "Page 2 of 2", **Next** disabled.
  3. Browser **Back** → page 1 again.
  4. On page 2, refresh → still page 2.
- [ ] **6.4 Bad page numbers.** `/admin?page=abc` → page 1. `/admin?page=99` → "No consultations on this page."
  and "Go to the last page (2)".
- [ ] **6.5 Admin can book their own** (decision 15). As admin, book via `/dashboard/new`: it appears on the admin's
  dashboard **and** in `/admin`.
- [ ] **6.6 Clean up** (SQL):
  ```sql
  delete from public.consultations where reason = 'Pagination test';
  ```

## 7. Timezones

- [ ] **7.1 Same moment, different clock.**
  1. Note a booking's time on the dashboard.
  2. DevTools → **⋮** menu → **More tools** → **Sensors** → **Location** → choose **Tokyo**.
  3. Reload: the same booking now shows Tokyo time (different hour, maybe different day).
  4. Set Location back to **No override**.
- [ ] **7.2 Booking in another timezone.** With Sensors set to Tokyo, book a consultation at 10:00. Check in Studio:
  `scheduled_at` is **01:00 UTC** that day (Tokyo is UTC+9). Set Location back to **No override**.
- [ ] **7.3 Automated timezone tests can fail.** Optional, proves the Sydney setup works:
  ```bash
  TZ=UTC npx vitest run tests/unit/datetime.test.ts
  ```
  Must **fail** with "datetime tests must run with TZ=Australia/Sydney". Then `npm test -- tests/unit/datetime.test.ts`
  passes.

## 8. Security: calling our API directly (DevTools Console)

Log in as **Student A**, open any app page, and run each snippet in the Console. Replace `<B_ID>`, `<A_DONE_ID>`
etc. with ids from step 0.7.

- [ ] **8.1 Another student's booking → 404 (not 403).**
  ```js
  await (await fetch("/api/consultations/<B_ID>", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) })).json()
  ```
  `{ error: { message: "Consultation not found" } }`. In Studio, Student B's booking is unchanged.
- [ ] **8.2 Ownership from the body is refused → 400.**
  ```js
  await (await fetch("/api/consultations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "A", lastName: "B", reason: "x", scheduledAt: "2999-01-01T10:00:00Z", studentId: "<B_STUDENT_ID>" }) })).json()
  ```
  `message: "Invalid input"`, and Student B gets no new booking.
- [ ] **8.3 Past time → 400 from the server.**
  ```js
  await (await fetch("/api/consultations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "A", lastName: "B", reason: "x", scheduledAt: "2000-01-01T00:00:00Z" }) })).json()
  ```
  `fieldErrors: { scheduledAt: ["Must be in the future"] }`.
- [ ] **8.4 Not allowed now → 409.** Cancel the completed booking (Done):
  ```js
  await (await fetch("/api/consultations/<A_DONE_ID>", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) })).json()
  ```
  `message: "Only upcoming scheduled consultations can be cancelled"`.
- [ ] **8.5 Non-UUID id → 404, not 500.**
  ```js
  (await fetch("/api/consultations/abc", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) })).status
  ```
  `404`.
- [ ] **8.6 Admin route as a student → 403.**
  ```js
  await (await fetch("/api/admin/consultations")).json()
  ```
  `{ error: { message: "Admins only" } }`.
- [ ] **8.7 Admin can't change a student's booking.** Log in as **admin**, run 8.1 with one of Student A's future
  booking ids: `404`, unchanged in Studio.
- [ ] **8.8 No delete.**
  ```js
  (await fetch("/api/consultations/<A_FUTURE_ID>", { method: "DELETE" })).status
  ```
  `405`.

## 9. Security: skipping our API (calling Supabase directly)

The publishable key ships to every browser, so anyone can call the database's REST API. Run these in a terminal
as Student A. The database itself must say no.

- [ ] **9.1 Get a token.**
  ```bash
  KEY=$(npx supabase status -o env | grep '^PUBLISHABLE_KEY=' | cut -d= -f2- | tr -d '"')
  URL=http://127.0.0.1:54321
  TOKEN=$(curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "content-type: application/json" \
    -d '{"email":"student-a@test.com","password":"password123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
  echo ${TOKEN:0:20}   # should print the start of a JWT
  ```
- [ ] **9.2 Read: only my rows.**
  ```bash
  curl -s "$URL/rest/v1/consultations?select=first_name,student_id" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
  ```
  Only Student A's bookings (no "Bee").
- [ ] **9.3 Make myself admin: refused.**
  ```bash
  curl -s -X PATCH "$URL/rest/v1/profiles?id=neq.00000000-0000-0000-0000-000000000000" -H "apikey: $KEY" \
    -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"role":"admin"}'
  ```
  Error with `"code":"42501"` (permission denied). SQL check: Student A is still `student`.
- [ ] **9.4 Change Student B's booking: nothing happens.**
  ```bash
  curl -s -X PATCH "$URL/rest/v1/consultations?id=eq.<B_ID>" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json" -H "Prefer: return=representation" -d '{"status":"cancelled"}'
  ```
  `[]` (0 rows: RLS hides it). Studio: still `scheduled`.
- [ ] **9.5 Break a business rule on my own row: refused.** Complete a **future** booking:
  ```bash
  curl -s -X PATCH "$URL/rest/v1/consultations?id=eq.<A_FUTURE_ID>" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json" -d '{"status":"completed"}'
  ```
  Error with `"code":"LM409"` (the trigger).
- [ ] **9.6 Edit a protected column: refused.**
  ```bash
  curl -s -X PATCH "$URL/rest/v1/consultations?id=eq.<A_FUTURE_ID>" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json" -d '{"reason":"changed"}'
  ```
  Error with `"code":"42501"` (column grants).
- [ ] **9.7 Delete: refused.**
  ```bash
  curl -s -X DELETE "$URL/rest/v1/consultations?id=eq.<A_FUTURE_ID>" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
  ```
  Error with `"code":"42501"`. Studio: the row still exists.
- [ ] **9.8 Book in the past: refused.**
  ```bash
  curl -s -X POST "$URL/rest/v1/consultations" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json" -d '{"first_name":"A","last_name":"B","reason":"x","scheduled_at":"2000-01-01T00:00:00Z"}'
  ```
  Error with `"code":"LM400"`.
- [ ] **9.9 Logged out: nothing at all.**
  ```bash
  curl -s "$URL/rest/v1/consultations?select=id" -H "apikey: $KEY"
  ```
  Error with `"code":"42501"` (no grants for `anon`).

## 10. Other checks

- [ ] **10.1 Open redirect is blocked (partly manual).** Open:
  `http://localhost:3000/auth/confirm?token_hash=x&type=email&next=//evil.example`
  You land on `/auth/error?...`, never on evil.example. (The token is fake, so this only shows the error path; the
  "valid token + bad next" path is covered by `tests/unit/safe-next-path.test.ts`.)
- [ ] **10.2 Lint rule blocks the service-role client in app code.**
  1. Create `lib/lint-check.ts`:
     ```ts
     import { admin } from "@/tests/helpers/admin-client";
     export const leak = admin;
     ```
  2. `npm run lint`: error "App code must not import from tests/ …".
  3. Delete `lib/lint-check.ts`, `npm run lint` again: exit code 0 (`echo $?`).
- [ ] **10.3 Testing "complete" the reviewer's way.** Move a booking into the past (SQL), reload, tick it:
  ```sql
  update public.consultations set scheduled_at = now() - interval '1 hour' where first_name = 'Future';
  ```
- [ ] **10.4 Leftover test users.** After `npm test`, there should be none (SQL):
  ```sql
  select count(*) from auth.users where email like 'test-%@example.test';   -- expect 0
  ```
  If not 0 (a crashed run): `delete from auth.users where email like 'test-%@example.test';`

---

## Notes

Write anything unexpected here (what you did, what you saw, what you expected).

-
