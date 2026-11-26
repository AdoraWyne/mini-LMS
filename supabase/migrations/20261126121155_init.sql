-- =============================================================================
-- Mini-LMS: initial schema
--
-- Layers of protection (see CLAUDE.md, decisions 2 and 17):
--   1. Grants   -> which ACTIONS and COLUMNS a role may touch   (checked first)
--   2. RLS      -> which ROWS a role may touch                  (ownership + roles)
--   3. Trigger  -> which STATE TRANSITIONS are allowed          (business rules, decision 6a)
-- The API repeats the business rules to give friendly errors; the database
-- enforces them again so direct Supabase calls (publishable key) can't skip them.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type public.app_role as enum ('student', 'admin');

-- One status column, so invalid combinations (e.g. cancelled + completed) can't exist (decision 6).
create type public.consultation_status as enum ('scheduled', 'completed', 'cancelled');


-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- Roles live in a table, not user_metadata (users can edit their own metadata) (decision 1).
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table public.consultations (
  id           uuid primary key default gen_random_uuid(),
  -- Defaults to the caller; RLS also checks it, so nobody can book for someone else.
  -- on delete cascade: deleting an account removes its personal data (decision 12).
  student_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- btrim: whitespace-only values fail. The API trims too (decision 8); this is the backstop.
  first_name   text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name    text not null check (char_length(btrim(last_name)) between 1 and 100),
  reason       text not null check (char_length(btrim(reason)) between 1 and 1000),
  -- timestamptz = one unambiguous moment, stored as UTC (decision 10).
  scheduled_at timestamptz not null,
  status       public.consultation_status not null default 'scheduled',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
  -- No CHECK (scheduled_at > now()): CHECKs must stay true forever, and every booking
  -- eventually becomes past. Time rules live in the trigger instead (section 9).
);


-- -----------------------------------------------------------------------------
-- 3. Indexes (match the "scheduled_at asc, id asc" sort, decision 16)
-- -----------------------------------------------------------------------------

-- Student dashboard: "my consultations, in order". Leading student_id also
-- serves as the index for the foreign key (Postgres doesn't create one automatically).
create index consultations_student_id_scheduled_at_id_idx
  on public.consultations (student_id, scheduled_at, id);

-- Admin list: all consultations, in order, paginated.
create index consultations_scheduled_at_id_idx
  on public.consultations (scheduled_at, id);


-- -----------------------------------------------------------------------------
-- 4. New user -> profile (decision 4)
-- -----------------------------------------------------------------------------

-- security definer: runs as the function owner, because the signing-up user has
-- no INSERT grant on profiles. search_path = '' stops anyone from hijacking
-- unqualified names, so every name below is schema-qualified.
-- It inserts only the id: role comes from the column default ('student') and
-- sign-up metadata is never read, so nobody can sign up as admin.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 5. is_admin() helper (used by RLS)
-- -----------------------------------------------------------------------------

-- security definer: reads profiles without going through profiles' own RLS
-- (avoids policy recursion and keeps the policy simple).
-- stable: same result within one statement, so Postgres can cache it.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants anon.
-- Only logged-in users' policies call it.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- -----------------------------------------------------------------------------
-- 6. Row Level Security (ownership + roles)
-- -----------------------------------------------------------------------------
-- (select auth.uid()) instead of auth.uid(): evaluated once per query, not once per row.

alter table public.profiles enable row level security;
alter table public.consultations enable row level security;

-- profiles: you can see your own row. No insert/update/delete policies:
-- nobody can change a role through the API (admins are made in Studio, decision 4a).
create policy "profiles: select own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- consultations: your own rows, or every row if you're an admin (read-only).
create policy "consultations: select own or admin"
  on public.consultations for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_admin())
  );

create policy "consultations: insert own"
  on public.consultations for insert
  to authenticated
  with check (student_id = (select auth.uid()));

-- using      = which existing rows you may target: your own, not cancelled.
-- with check = what the row must look like afterwards: still yours.
-- They differ on purpose: cancelling produces a cancelled row, so "not cancelled"
-- can't be in with check. No admin update policy: admin is read-only.
create policy "consultations: update own active"
  on public.consultations for update
  to authenticated
  using (
    student_id = (select auth.uid())
    and status <> 'cancelled'
  )
  with check (student_id = (select auth.uid()));

-- No delete policy (soft cancel only, decision 5).


-- -----------------------------------------------------------------------------
-- 7. Grants (least privilege, decision 17)
-- -----------------------------------------------------------------------------
-- Supabase grants ALL privileges on new public tables to anon and authenticated.
-- Start from nothing and add back only what the app needs.
-- Grants are checked before RLS:
--   missing grant              -> permission error (42501)
--   granted, but RLS hides row -> 0 rows, no error

revoke all on table public.profiles, public.consultations from anon, authenticated;

-- profiles: read only.
grant select on table public.profiles to authenticated;

-- consultations:
--   insert: only the booking fields. id, status, created_at, updated_at come from defaults.
--   update: only what an action can change. Names, reason, student_id, created_at are fixed
--           after booking; updated_at is set by a trigger (section 8), so the API never sends it.
--   no delete, no truncate (truncate would ignore RLS).
grant select on table public.consultations to authenticated;
grant insert (student_id, first_name, last_name, reason, scheduled_at)
  on table public.consultations to authenticated;
grant update (status, scheduled_at)
  on table public.consultations to authenticated;


-- -----------------------------------------------------------------------------
-- 8. updated_at trigger
-- -----------------------------------------------------------------------------
-- Like Rails' automatic timestamps. A trigger can write a column the caller has no
-- grant on, so callers can't fake updated_at. Not security definer: it doesn't need to be.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Note: BEFORE triggers on the same table fire in alphabetical order of trigger name,
-- so consultations_enforce_rules runs before consultations_set_updated_at.
-- Order doesn't matter here: the rules never look at updated_at.
create trigger consultations_set_updated_at
  before update on public.consultations
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 9. Business-rule trigger (decision 6a, enforced for every door)
-- -----------------------------------------------------------------------------
-- The API checks the same rules first (zod + UPDATE ... WHERE) to return friendly
-- 400/409s. This trigger is the backstop for direct Supabase calls.
-- KEEP IN SYNC with the decision 6a table and the API's WHERE clauses.
--
-- Error codes (custom SQLSTATE, 5 chars) so the API maps them to 400/409, never 500:
--   LM400 -> problem in what was sent        -> 400
--   LM409 -> not allowed in the current state -> 409
--
-- NOT security definer on purpose: we need current_user to be the caller's role.
-- (In a security definer function, current_user is the function owner.)

create function public.enforce_consultation_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only app users (our API and direct Supabase calls both run as 'authenticated').
  -- Operators (postgres in Studio, seed scripts) are trusted, so they can fix data
  -- and set up test cases, e.g. move a booking into the past to test "complete".
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- ---- INSERT: a new booking must be scheduled and in the future ----
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      raise exception 'New consultations must be scheduled'
        using errcode = 'LM400';
    end if;
    if new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future'
        using errcode = 'LM400';
    end if;
    return new;
  end if;

  -- ---- UPDATE ----
  -- Checks follow the API order: 400 (what you sent) before 409 (current state).

  -- Reschedule: scheduled -> scheduled, and the time must actually change.
  -- Without the "unchanged" check, any no-op update on a scheduled row (e.g. a direct
  -- `set status = 'scheduled'`, an "uncomplete" of something that isn't completed)
  -- would pass as a "reschedule" to the same time.
  if old.status = 'scheduled' and new.status = 'scheduled' then
    if new.scheduled_at <= now() then
      raise exception 'New consultation time must be in the future'
        using errcode = 'LM400';
    end if;
    if new.scheduled_at is not distinct from old.scheduled_at then
      raise exception 'New consultation time must be different from the current one'
        using errcode = 'LM400';
    end if;
    if old.scheduled_at <= now() then
      raise exception 'Only upcoming consultations can be rescheduled'
        using errcode = 'LM409';
    end if;
    return new;
  end if;

  -- Every other update is a status change, and a status change must not move the time.
  -- Without this, a direct call could uncomplete a past booking AND move it to next week,
  -- making it cancellable/reschedulable again.
  if new.scheduled_at is distinct from old.scheduled_at then
    raise exception 'Consultation time can only change when rescheduling'
      using errcode = 'LM400';
  end if;

  -- Complete: scheduled -> completed, only once the time has passed.
  if old.status = 'scheduled' and new.status = 'completed' then
    if old.scheduled_at > now() then
      raise exception 'Consultations can only be completed after their time'
        using errcode = 'LM409';
    end if;
    return new;
  end if;

  -- Uncomplete: completed -> scheduled, always (an undo for a mistaken tick).
  if old.status = 'completed' and new.status = 'scheduled' then
    return new;
  end if;

  -- Cancel: scheduled -> cancelled, only while still upcoming.
  if old.status = 'scheduled' and new.status = 'cancelled' then
    if old.scheduled_at <= now() then
      raise exception 'Only upcoming consultations can be cancelled'
        using errcode = 'LM409';
    end if;
    return new;
  end if;

  -- Anything else (e.g. completed -> cancelled, cancelled -> anything, completed -> completed).
  raise exception 'Cannot change status from % to %', old.status, new.status
    using errcode = 'LM409';
end;
$$;

create trigger consultations_enforce_rules
  before insert or update on public.consultations
  for each row execute function public.enforce_consultation_rules();
