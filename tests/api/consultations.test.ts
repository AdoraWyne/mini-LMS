/**
 * API tests for GET/POST /api/consultations. Journeys: docs/user-journeys.md sections 2, 3, 6.
 * Real HTTP to the running app (`npm run dev`) with real session cookies.
 *
 * Data isolation: every row here belongs to this file's throwaway users. The admin's GET
 * only returns the admin's own rows, so your manual data never affects these assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsultationDto } from "@/lib/api/mappers";
import type { ApiErrorBody, ApiSuccess } from "@/lib/api/http";
import { admin } from "../helpers/admin-client";
import { daysFromNow, seedConsultation } from "../helpers/fixtures";
import { api, assertDevServerRunning, sessionCookieFor, type ApiClient } from "../helpers/http";
import { cleanupTestUsers, createTestUser, type TestUser } from "../helpers/users";

const PATH = "/api/consultations";

const FAR_FUTURE = "2999-01-01T10:00:00.000Z";
const FAR_PAST = "2000-01-01T10:00:00.000Z";

const validBooking = {
  firstName: "Ada",
  lastName: "Lovelace",
  reason: "Help with my essay",
  scheduledAt: FAR_FUTURE,
};

let studentA: TestUser;
let studentB: TestUser;
let adminUser: TestUser;
let apiA: ApiClient;
let apiAdmin: ApiClient;

beforeAll(async () => {
  await assertDevServerRunning();
  studentA = await createTestUser("student");
  studentB = await createTestUser("student");
  adminUser = await createTestUser("admin");
  apiA = await api.as(studentA);
  apiAdmin = await api.as(adminUser);
});

afterAll(async () => {
  await cleanupTestUsers();
});

function dataOf<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

function errorOf(body: unknown): ApiErrorBody["error"] {
  return (body as ApiErrorBody).error;
}

/** Verification read (admin): how many consultations a student has, regardless of RLS. */
async function countConsultationsOf(studentId: string): Promise<number> {
  const { count, error } = await admin
    .from("consultations")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * A real session cookie for `user`, with the JWT's `sub` swapped to `otherUserId` and the
 * signature left as-is. An attacker can edit the payload, but can't re-sign it.
 */
async function tamperedCookie(user: TestUser, otherUserId: string): Promise<string> {
  const cookie = await sessionCookieFor(user);
  const separator = cookie.indexOf("=");
  const name = cookie.slice(0, separator);
  const value = cookie.slice(separator + 1);
  if (cookie.includes(";") || !value.startsWith("base64-")) {
    throw new Error("tamperedCookie expects a single base64- session cookie");
  }

  const session = JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString("utf8"));
  const [header, payload, signature] = String(session.access_token).split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, sub: otherUserId })).toString("base64url");
  const forgedSession = { ...session, access_token: `${header}.${forgedPayload}.${signature}` };

  return `${name}=base64-${Buffer.from(JSON.stringify(forgedSession)).toString("base64url")}`;
}

describe("GET /api/consultations", () => {
  it("returns 401 with the error shape when logged out (no redirect)", async () => {
    const { status, body } = await api.anon().get(PATH);
    expect(status).toBe(401);
    expect(body).toEqual({ error: { message: expect.any(String) } });
  });

  it("returns { data: [] } for a student with no bookings", async () => {
    const fresh = await createTestUser("student");
    const { status, body } = await (await api.as(fresh)).get(PATH);
    expect(status).toBe(200);
    expect(body).toEqual({ data: [] });
  });

  it("returns only my consultations, never another student's", async () => {
    const mine = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(3) });
    const theirs = await seedConsultation({ studentId: studentB.id, scheduledAt: daysFromNow(3) });

    const { status, body } = await apiA.get(PATH);
    expect(status).toBe(200);
    const rows = dataOf<ConsultationDto[]>(body);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(rows.every((row) => row.studentId === studentA.id)).toBe(true);
  });

  // Limit: today Postgres returns tied rows in id order anyway (it reads the
  // (student_id, scheduled_at, id) index), so removing `.order("id")` doesn't fail this test.
  // The explicit order is the guarantee; the index order is an implementation detail.
  it("orders by scheduledAt ascending, then id (stable for equal times)", async () => {
    const owner = await createTestUser("student");
    const sameTime = daysFromNow(10);
    await seedConsultation({ studentId: owner.id, scheduledAt: daysFromNow(20) });
    await seedConsultation({ studentId: owner.id, scheduledAt: sameTime });
    await seedConsultation({ studentId: owner.id, scheduledAt: sameTime });
    await seedConsultation({ studentId: owner.id, scheduledAt: daysFromNow(-5) });

    const rows = dataOf<ConsultationDto[]>((await (await api.as(owner)).get(PATH)).body);
    const sorted = [...rows].sort(
      (a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id),
    );
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.id)).toEqual(sorted.map((row) => row.id));
  });

  it("returns camelCase fields only", async () => {
    await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(4) });
    const [first] = dataOf<ConsultationDto[]>((await apiA.get(PATH)).body);
    expect(Object.keys(first).sort()).toEqual(
      ["createdAt", "firstName", "id", "lastName", "reason", "scheduledAt", "status", "studentId", "updatedAt"].sort(),
    );
  });

  it("includes cancelled consultations (decision 6d)", async () => {
    const cancelled = await seedConsultation({
      studentId: studentA.id,
      scheduledAt: daysFromNow(6),
      status: "cancelled",
    });
    const rows = dataOf<ConsultationDto[]>((await apiA.get(PATH)).body);
    expect(rows.find((row) => row.id === cancelled)?.status).toBe("cancelled");
  });

  it("an admin gets only their own consultations here (the full list is the admin route)", async () => {
    const adminsOwn = await seedConsultation({ studentId: adminUser.id, scheduledAt: daysFromNow(2) });
    const studentsBooking = await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) });

    const rows = dataOf<ConsultationDto[]>((await apiAdmin.get(PATH)).body);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(adminsOwn);
    expect(ids).not.toContain(studentsBooking);
    expect(rows.every((row) => row.studentId === adminUser.id)).toBe(true);
  });
});

describe("POST /api/consultations", () => {
  it("returns 401 when logged out, and creates nothing", async () => {
    const { status, body } = await api.anon().post(PATH, validBooking);
    expect(status).toBe(401);
    expect(errorOf(body).message).toEqual(expect.any(String));
  });

  it("checks auth before input: logged out + invalid JSON is 401, not 400", async () => {
    const { status } = await api.anon().post(PATH, undefined, { rawBody: "{not json" });
    expect(status).toBe(401);
  });

  it("books a consultation: 201, scheduled, owned by me, trimmed, and saved", async () => {
    const before = await countConsultationsOf(studentA.id);
    const { status, body } = await apiA.post(PATH, {
      ...validBooking,
      firstName: "  Ada ",
      reason: " Help with my essay  ",
    });

    expect(status).toBe(201);
    const created = dataOf<ConsultationDto>(body);
    expect(created).toMatchObject({
      studentId: studentA.id,
      firstName: "Ada",
      lastName: "Lovelace",
      reason: "Help with my essay",
      scheduledAt: FAR_FUTURE,
      status: "scheduled",
    });
    expect(created.id).toEqual(expect.any(String));
    expect(await countConsultationsOf(studentA.id)).toBe(before + 1);
  });

  it("a new booking shows up in my list", async () => {
    const created = dataOf<ConsultationDto>((await apiA.post(PATH, validBooking)).body);
    const rows = dataOf<ConsultationDto[]>((await apiA.get(PATH)).body);
    expect(rows.map((row) => row.id)).toContain(created.id);
  });

  it("an admin can book their own consultation (decision 15)", async () => {
    const { status, body } = await apiAdmin.post(PATH, validBooking);
    expect(status).toBe(201);
    expect(dataOf<ConsultationDto>(body).studentId).toBe(adminUser.id);
  });

  it("returns 400 for invalid JSON", async () => {
    const { status, body } = await apiA.post(PATH, undefined, { rawBody: "{not json" });
    expect(status).toBe(400);
    expect(errorOf(body).message).toBe("Request body must be valid JSON");
  });

  it("returns 400 with field details for a missing field", async () => {
    const withoutFirstName: Partial<typeof validBooking> = { ...validBooking };
    delete withoutFirstName.firstName;
    const { status, body } = await apiA.post(PATH, withoutFirstName);
    expect(status).toBe(400);
    expect(errorOf(body).details?.fieldErrors.firstName).toBeDefined();
  });

  it("returns 400 for a whitespace-only reason", async () => {
    const { status, body } = await apiA.post(PATH, { ...validBooking, reason: "   " });
    expect(status).toBe(400);
    expect(errorOf(body).details?.fieldErrors.reason).toBeDefined();
  });

  it("returns 400 for a name over 100 characters", async () => {
    const { status } = await apiA.post(PATH, { ...validBooking, lastName: "a".repeat(101) });
    expect(status).toBe(400);
  });

  it("returns 400 for a time in the past", async () => {
    const { status, body } = await apiA.post(PATH, { ...validBooking, scheduledAt: FAR_PAST });
    expect(status).toBe(400);
    expect(errorOf(body).details?.fieldErrors.scheduledAt).toBeDefined();
  });

  it("returns 400 for a time without a timezone offset", async () => {
    const { status } = await apiA.post(PATH, { ...validBooking, scheduledAt: "2999-01-01T10:00" });
    expect(status).toBe(400);
  });

  it("returns 400 for studentId in the body, and books nothing for that student", async () => {
    const before = await countConsultationsOf(studentB.id);
    const { status } = await apiA.post(PATH, { ...validBooking, studentId: studentB.id });
    expect(status).toBe(400);
    expect(await countConsultationsOf(studentB.id)).toBe(before);
  });
});

describe("forged session cookies", () => {
  const forgeries: Array<[string, () => Promise<string>]> = [
    ["a garbage cookie value", async () => "sb-127-auth-token=garbage"],
    ["a garbage base64- session", async () => `sb-127-auth-token=base64-${Buffer.from("nope").toString("base64url")}`],
    ["Student A's session with sub swapped to Student B (bad signature)", () => tamperedCookie(studentA, studentB.id)],
  ];

  it.each(forgeries)("GET with %s returns 401 and no data", async (_label, makeCookie) => {
    await seedConsultation({ studentId: studentB.id, scheduledAt: daysFromNow(3) });
    const { status, body } = await api.withCookie(await makeCookie()).get(PATH);
    expect(status).toBe(401);
    expect(body).toEqual({ error: { message: expect.any(String) } });
  });

  it.each(forgeries)("POST with %s returns 401 and creates nothing", async (_label, makeCookie) => {
    const beforeA = await countConsultationsOf(studentA.id);
    const beforeB = await countConsultationsOf(studentB.id);
    const { status } = await api.withCookie(await makeCookie()).post(PATH, validBooking);
    expect(status).toBe(401);
    expect(await countConsultationsOf(studentA.id)).toBe(beforeA);
    expect(await countConsultationsOf(studentB.id)).toBe(beforeB);
  });

  it("sanity check: an untampered cookie for the same user works", async () => {
    const { status } = await api.withCookie(await sessionCookieFor(studentA)).get(PATH);
    expect(status).toBe(200);
  });
});
