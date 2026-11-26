/**
 * DB security tests: docs/user-journeys.md, section 7 ("someone skips our API").
 *
 * Every assertion calls Supabase directly with the PUBLISHABLE key as a real user,
 * which is exactly what an attacker can do from the browser. `admin` (service role)
 * is only used for setup and to double-check that rows really didn't change.
 *
 * Note: written AFTER the migration (not test-first). They lock in its behaviour.
 *
 * Error codes we expect from Postgres / PostgREST:
 *   42501 -> permission denied (missing grant) or RLS rejected an INSERT
 *   23514 -> CHECK constraint failed
 *   LM400 -> our trigger: problem in what was sent
 *   LM409 -> our trigger: transition not allowed in the current state/time
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "../helpers/admin-client";
import { daysFromNow, readConsultationAsAdmin, seedConsultation } from "../helpers/fixtures";
import {
  asAdmin,
  asAnon,
  asStudent,
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from "../helpers/users";

const PERMISSION_DENIED = "42501";

const validBooking = {
  first_name: "Ada",
  last_name: "Lovelace",
  reason: "Help with my essay",
};

let studentA: TestUser;
let studentB: TestUser;
let adminUser: TestUser;
let clientA: SupabaseClient;
let clientAdmin: SupabaseClient;

beforeAll(async () => {
  studentA = await createTestUser("student");
  studentB = await createTestUser("student");
  adminUser = await createTestUser("admin");
  clientA = await asStudent(studentA);
  clientAdmin = await asAdmin(adminUser);
});

afterAll(async () => {
  await cleanupTestUsers();
});

describe("logged out (anon)", () => {
  it("cannot read consultations (no grants for anon)", async () => {
    const { error } = await asAnon().from("consultations").select("id");
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("cannot read profiles (no grants for anon)", async () => {
    const { error } = await asAnon().from("profiles").select("id");
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("cannot insert a consultation", async () => {
    const { error } = await asAnon()
      .from("consultations")
      .insert({ ...validBooking, scheduled_at: daysFromNow(1) });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("cannot call is_admin()", async () => {
    const { error } = await asAnon().rpc("is_admin");
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("signing up", () => {
  it("creates a profile with role student", async () => {
    const { data, error } = await clientA.from("profiles").select("id, role");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: studentA.id, role: "student" }]);
  });
});

describe("reading", () => {
  let bookingA: string;
  let bookingB: string;

  beforeAll(async () => {
    bookingA = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(3) });
    bookingB = await seedConsultation({ studentId: studentB.id, scheduledAt: daysFromNow(3) });
  });

  it("a student only sees their own consultations", async () => {
    const { data, error } = await clientA.from("consultations").select("id, student_id");
    expect(error).toBeNull();
    const ids = data!.map((row) => row.id);
    expect(ids).toContain(bookingA);
    expect(ids).not.toContain(bookingB);
    expect(data!.every((row) => row.student_id === studentA.id)).toBe(true);
  });

  it("a student only sees their own profile", async () => {
    const { data, error } = await clientA.from("profiles").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: studentA.id }]);
  });

  it("an admin sees every student's consultations", async () => {
    const { data, error } = await clientAdmin
      .from("consultations")
      .select("id")
      .in("id", [bookingA, bookingB]);
    expect(error).toBeNull();
    expect(data!.map((row) => row.id).sort()).toEqual([bookingA, bookingB].sort());
  });

  it("is_admin() is false for a student and true for an admin", async () => {
    const asStudentResult = await clientA.rpc("is_admin");
    const asAdminResult = await clientAdmin.rpc("is_admin");
    expect(asStudentResult).toMatchObject({ data: false, error: null });
    expect(asAdminResult).toMatchObject({ data: true, error: null });
  });
});

describe("inserting", () => {
  it("a student can book a future consultation for themselves (student_id defaults to them)", async () => {
    const { data, error } = await clientA
      .from("consultations")
      .insert({ ...validBooking, scheduled_at: daysFromNow(2) })
      .select("student_id, status")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ student_id: studentA.id, status: "scheduled" });
  });

  it("a student cannot book for another student (RLS)", async () => {
    const { error } = await clientA
      .from("consultations")
      .insert({ ...validBooking, student_id: studentB.id, scheduled_at: daysFromNow(2) });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each([
    ["id", "00000000-0000-0000-0000-000000000001"],
    ["status", "scheduled"],
    ["created_at", daysFromNow(-30)],
    ["updated_at", daysFromNow(-30)],
  ])("a student cannot set %s on insert (column grants)", async (column, value) => {
    const { error } = await clientA
      .from("consultations")
      .insert({ ...validBooking, scheduled_at: daysFromNow(2), [column]: value });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("a student cannot book a time in the past (trigger LM400)", async () => {
    const { error } = await clientA
      .from("consultations")
      .insert({ ...validBooking, scheduled_at: daysFromNow(-1) });
    expect(error?.code).toBe("LM400");
  });

  it("a whitespace-only name is rejected (btrim CHECK)", async () => {
    const { error } = await clientA
      .from("consultations")
      .insert({ ...validBooking, first_name: "   ", scheduled_at: daysFromNow(2) });
    expect(error?.code).toBe("23514");
  });

  it("a student cannot insert a profile (profiles is SELECT only)", async () => {
    const { error } = await clientA.from("profiles").insert({ id: studentA.id, role: "admin" });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("updating: allowed transitions (the trigger doesn't over-block)", () => {
  it("complete: a past scheduled booking can be completed", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(-1) });
    const { data, error } = await clientA
      .from("consultations")
      .update({ status: "completed" })
      .eq("id", id)
      .select("status");
    expect(error).toBeNull();
    expect(data).toEqual([{ status: "completed" }]);
  });

  it("uncomplete: a completed booking goes back to scheduled", async () => {
    const id = await seedConsultation({
      studentId: studentA.id,
      scheduledAt: daysFromNow(-1),
      status: "completed",
    });
    const { data, error } = await clientA
      .from("consultations")
      .update({ status: "scheduled" })
      .eq("id", id)
      .select("status");
    expect(error).toBeNull();
    expect(data).toEqual([{ status: "scheduled" }]);
  });

  it("cancel: a future scheduled booking can be cancelled", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { data, error } = await clientA
      .from("consultations")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select("status");
    expect(error).toBeNull();
    expect(data).toEqual([{ status: "cancelled" }]);
  });

  it("reschedule: a future scheduled booking can move to another future time", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const newTime = daysFromNow(5);
    const { data, error } = await clientA
      .from("consultations")
      .update({ scheduled_at: newTime })
      .eq("id", id)
      .select("scheduled_at");
    expect(error).toBeNull();
    expect(new Date(data![0].scheduled_at).toISOString()).toBe(newTime);
  });

  it("updated_at is set by the database trigger on every update", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const before = await readConsultationAsAdmin(id);
    await clientA.from("consultations").update({ scheduled_at: daysFromNow(4) }).eq("id", id);
    const after = await readConsultationAsAdmin(id);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });
});

describe("updating: blocked", () => {
  it("a student updating another student's row changes 0 rows, no error (RLS hides it)", async () => {
    const id = await seedConsultation({ studentId: studentB.id, scheduledAt: daysFromNow(2) });
    const { data, error } = await clientA
      .from("consultations")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await readConsultationAsAdmin(id)).status).toBe("scheduled");
  });

  it("an admin updating a student's row changes 0 rows (no admin update policy)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { data, error } = await clientAdmin
      .from("consultations")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await readConsultationAsAdmin(id)).status).toBe("scheduled");
  });

  it("a cancelled booking can't be updated by its owner (RLS: not cancelled)", async () => {
    const id = await seedConsultation({
      studentId: studentA.id,
      scheduledAt: daysFromNow(2),
      status: "cancelled",
    });
    const { data, error } = await clientA
      .from("consultations")
      .update({ status: "scheduled" })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await readConsultationAsAdmin(id)).status).toBe("cancelled");
  });

  it("a student cannot change their own role (profiles is SELECT only)", async () => {
    const { error } = await clientA.from("profiles").update({ role: "admin" }).eq("id", studentA.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await admin.from("profiles").select("role").eq("id", studentA.id).single();
    expect(data?.role).toBe("student");
  });

  it.each([
    ["reason", "changed"],
    ["first_name", "Changed"],
    ["last_name", "Changed"],
    ["student_id", "00000000-0000-0000-0000-000000000001"],
    ["id", "00000000-0000-0000-0000-000000000001"],
    ["created_at", daysFromNow(-30)],
    ["updated_at", daysFromNow(-30)],
  ])("a student cannot update %s on their own row (column grants)", async (column, value) => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { error } = await clientA
      .from("consultations")
      .update({ [column]: value })
      .eq("id", id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("completing a future booking is blocked (trigger LM409)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { error } = await clientA.from("consultations").update({ status: "completed" }).eq("id", id);
    expect(error?.code).toBe("LM409");
  });

  it("cancelling a past booking is blocked (trigger LM409)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(-1) });
    const { error } = await clientA.from("consultations").update({ status: "cancelled" }).eq("id", id);
    expect(error?.code).toBe("LM409");
  });

  it("rescheduling a past booking is blocked (trigger LM409)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(-1) });
    const { error } = await clientA
      .from("consultations")
      .update({ scheduled_at: daysFromNow(3) })
      .eq("id", id);
    expect(error?.code).toBe("LM409");
  });

  it("rescheduling to a past time is blocked (trigger LM400)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { error } = await clientA
      .from("consultations")
      .update({ scheduled_at: daysFromNow(-1) })
      .eq("id", id);
    expect(error?.code).toBe("LM400");
  });

  it("uncompleting AND moving the time in one update is blocked (trigger LM400)", async () => {
    const id = await seedConsultation({
      studentId: studentA.id,
      scheduledAt: daysFromNow(-1),
      status: "completed",
    });
    const { error } = await clientA
      .from("consultations")
      .update({ status: "scheduled", scheduled_at: daysFromNow(7) })
      .eq("id", id);
    expect(error?.code).toBe("LM400");
    const row = await readConsultationAsAdmin(id);
    expect(row.status).toBe("completed");
  });

  it("completed -> cancelled is blocked (trigger LM409)", async () => {
    const id = await seedConsultation({
      studentId: studentA.id,
      scheduledAt: daysFromNow(-1),
      status: "completed",
    });
    const { error } = await clientA.from("consultations").update({ status: "cancelled" }).eq("id", id);
    expect(error?.code).toBe("LM409");
  });
});

describe("deleting", () => {
  it("a student cannot delete their own consultation (no DELETE grant)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { error } = await clientA.from("consultations").delete().eq("id", id);
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect((await readConsultationAsAdmin(id)).id).toBe(id);
  });

  it("an admin cannot delete a consultation (no DELETE grant)", async () => {
    const id = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });
    const { error } = await clientAdmin.from("consultations").delete().eq("id", id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("a student cannot delete their profile (no DELETE grant)", async () => {
    const { error } = await clientA.from("profiles").delete().eq("id", studentA.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("operators (service_role), used for setup and in Studio", () => {
  it("service_role can insert a past booking (the trigger only enforces rules for authenticated)", async () => {
    const { data, error } = await admin
      .from("consultations")
      .insert({ ...validBooking, student_id: studentB.id, scheduled_at: daysFromNow(-2) })
      .select("scheduled_at")
      .single();
    expect(error).toBeNull();
    expect(new Date(data!.scheduled_at).getTime()).toBeLessThan(Date.now());
  });

  it("service_role can update a profile's role (the migration's revokes didn't touch service_role)", async () => {
    const target = await createTestUser("student");
    const { data, error } = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", target.id)
      .select("role");
    expect(error).toBeNull();
    expect(data).toEqual([{ role: "admin" }]);
  });
});
