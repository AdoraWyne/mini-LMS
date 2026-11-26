/**
 * API tests for PATCH /api/consultations/[id]. Journeys: docs/user-journeys.md sections 4, 6, 8 (concurrency).
 * Real HTTP to the running app (`npm run dev`) with real session cookies.
 *
 * Every 404/409 is followed by a verification read (admin) proving the row didn't change.
 * Past/future rows are seeded far from "now" (days, not seconds), so time checks can't flake.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsultationDto } from "@/lib/api/mappers";
import type { ApiErrorBody, ApiSuccess } from "@/lib/api/http";
import { daysFromNow, readConsultationAsAdmin, seedConsultation, type ConsultationStatus } from "../helpers/fixtures";
import { api, assertDevServerRunning, type ApiClient } from "../helpers/http";
import { cleanupTestUsers, createTestUser, type TestUser } from "../helpers/users";

const FAR_FUTURE = "2999-01-01T10:00:00.000Z";
const FAR_PAST = "2000-01-01T10:00:00.000Z";

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

const pathFor = (id: string) => `/api/consultations/${id}`;

function dataOf(body: unknown): ConsultationDto {
  return (body as ApiSuccess<ConsultationDto>).data;
}

function errorOf(body: unknown): ApiErrorBody["error"] {
  return (body as ApiErrorBody).error;
}

/** Seeds a row for `owner` in a given state. "past"/"future" = a few days from now. */
async function seed(owner: TestUser, status: ConsultationStatus, when: "past" | "future"): Promise<string> {
  return seedConsultation({ studentId: owner.id, scheduledAt: daysFromNow(when === "past" ? -2 : 2), status });
}

/** Verification read: the row's status and time are exactly what they were. */
async function expectUnchanged(id: string, before: { status: string; scheduled_at: string }) {
  const after = await readConsultationAsAdmin(id);
  expect(after.status).toBe(before.status);
  expect(new Date(after.scheduled_at).getTime()).toBe(new Date(before.scheduled_at).getTime());
}

/** PATCH as Student A and expect a 409 that leaves the row untouched. */
async function expect409(id: string, body: unknown) {
  const before = await readConsultationAsAdmin(id);
  const { status, body: responseBody } = await apiA.patch(pathFor(id), body);
  expect(status).toBe(409);
  expect(errorOf(responseBody).message).toEqual(expect.any(String));
  await expectUnchanged(id, before);
}

describe("complete", () => {
  it("a past scheduled consultation can be completed (200)", async () => {
    const id = await seed(studentA, "scheduled", "past");
    const { status, body } = await apiA.patch(pathFor(id), { action: "complete" });
    expect(status).toBe(200);
    expect(dataOf(body)).toMatchObject({ id, status: "completed" });
  });

  it("a future scheduled consultation can't be completed yet (409)", async () => {
    await expect409(await seed(studentA, "scheduled", "future"), { action: "complete" });
  });

  it.each([["completed"], ["cancelled"]] as const)("a %s consultation can't be completed (409)", async (state) => {
    await expect409(await seed(studentA, state, "past"), { action: "complete" });
  });
});

describe("uncomplete", () => {
  it("a completed consultation goes back to scheduled (200)", async () => {
    const id = await seed(studentA, "completed", "past");
    const { status, body } = await apiA.patch(pathFor(id), { action: "uncomplete" });
    expect(status).toBe(200);
    expect(dataOf(body)).toMatchObject({ id, status: "scheduled" });
  });

  it.each([
    ["scheduled", "past"],
    ["scheduled", "future"],
    ["cancelled", "future"],
  ] as const)("a %s (%s) consultation can't be uncompleted (409)", async (state, when) => {
    await expect409(await seed(studentA, state, when), { action: "uncomplete" });
  });

  it("after uncompleting, it can't be rescheduled or cancelled (its time has passed)", async () => {
    const id = await seed(studentA, "completed", "past");
    expect((await apiA.patch(pathFor(id), { action: "uncomplete" })).status).toBe(200);
    await expect409(id, { action: "reschedule", scheduledAt: FAR_FUTURE });
    await expect409(id, { action: "cancel" });
  });
});

describe("cancel", () => {
  it("a future scheduled consultation is soft-cancelled (200, row kept)", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const { status, body } = await apiA.patch(pathFor(id), { action: "cancel" });
    expect(status).toBe(200);
    expect(dataOf(body)).toMatchObject({ id, status: "cancelled" });
    expect((await readConsultationAsAdmin(id)).status).toBe("cancelled");
  });

  it("a past scheduled consultation can't be cancelled (409)", async () => {
    await expect409(await seed(studentA, "scheduled", "past"), { action: "cancel" });
  });

  it.each([
    ["completed", "past"],
    ["cancelled", "future"],
  ] as const)("a %s consultation can't be cancelled (409)", async (state, when) => {
    await expect409(await seed(studentA, state, when), { action: "cancel" });
  });
});

describe("reschedule", () => {
  it("a future scheduled consultation moves to the new time, still scheduled (200)", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const { status, body } = await apiA.patch(pathFor(id), { action: "reschedule", scheduledAt: FAR_FUTURE });
    expect(status).toBe(200);
    expect(dataOf(body)).toMatchObject({ id, status: "scheduled", scheduledAt: FAR_FUTURE });
  });

  it("updates updatedAt", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const before = await readConsultationAsAdmin(id);
    const { body } = await apiA.patch(pathFor(id), { action: "reschedule", scheduledAt: FAR_FUTURE });
    expect(new Date(dataOf(body).updatedAt).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });

  it("a past scheduled consultation can't be rescheduled (409)", async () => {
    await expect409(await seed(studentA, "scheduled", "past"), { action: "reschedule", scheduledAt: FAR_FUTURE });
  });

  it.each([
    ["completed", "past"],
    ["cancelled", "future"],
  ] as const)("a %s consultation can't be rescheduled (409)", async (state, when) => {
    await expect409(await seed(studentA, state, when), { action: "reschedule", scheduledAt: FAR_FUTURE });
  });

  it("rescheduling to a past time is a 400 (problem in what was sent)", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const before = await readConsultationAsAdmin(id);
    const { status, body } = await apiA.patch(pathFor(id), { action: "reschedule", scheduledAt: FAR_PAST });
    expect(status).toBe(400);
    expect(errorOf(body).details?.fieldErrors.scheduledAt).toBeDefined();
    await expectUnchanged(id, before);
  });

  it("rescheduling to the exact same time is a 400 (the trigger requires a change)", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const before = await readConsultationAsAdmin(id);
    const sameTime = new Date(before.scheduled_at).toISOString();
    const { status, body } = await apiA.patch(pathFor(id), { action: "reschedule", scheduledAt: sameTime });
    expect(status).toBe(400);
    expect(errorOf(body).message).toBe("New consultation time must be different from the current one");
    await expectUnchanged(id, before);
  });

  it("reschedule without scheduledAt is a 400", async () => {
    const id = await seed(studentA, "scheduled", "future");
    expect((await apiA.patch(pathFor(id), { action: "reschedule" })).status).toBe(400);
  });
});

describe("ownership (404, never 403)", () => {
  it("another student's consultation is a 404, and stays unchanged", async () => {
    const id = await seed(studentB, "scheduled", "future");
    const before = await readConsultationAsAdmin(id);
    const { status } = await apiA.patch(pathFor(id), { action: "cancel" });
    expect(status).toBe(404);
    await expectUnchanged(id, before);
  });

  it("a UUID that doesn't exist is a 404", async () => {
    expect((await apiA.patch(pathFor(randomUUID()), { action: "cancel" })).status).toBe(404);
  });

  it.each(["abc", "123", "not-a-uuid"])("a non-UUID id (%s) is a 404, not a 500", async (id) => {
    const { status, body } = await apiA.patch(pathFor(id), { action: "cancel" });
    expect(status).toBe(404);
    expect(errorOf(body).message).toEqual(expect.any(String));
  });

  it("an admin can't change a student's consultation: 404 (admin is read-only)", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const before = await readConsultationAsAdmin(id);
    const { status } = await apiAdmin.patch(pathFor(id), { action: "cancel" });
    expect(status).toBe(404);
    await expectUnchanged(id, before);
  });

  it("an admin can change their own consultation (decision 15)", async () => {
    const id = await seed(adminUser, "scheduled", "future");
    expect((await apiAdmin.patch(pathFor(id), { action: "cancel" })).status).toBe(200);
  });
});

describe("check order: 401 -> 400 (id first -> 404, then body) -> 404 -> 409", () => {
  it("logged out is 401 even with a bad id and a bad body", async () => {
    const { status } = await api.anon().patch(pathFor("abc"), undefined, { rawBody: "{not json" });
    expect(status).toBe(401);
  });

  it("a forged session cookie is 401", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const { status } = await api.withCookie("sb-127-auth-token=garbage").patch(pathFor(id), { action: "cancel" });
    expect(status).toBe(401);
  });

  it("a non-UUID id with an invalid body is 404 (the id is checked before the body)", async () => {
    const { status } = await apiA.patch(pathFor("abc"), { action: "delete" });
    expect(status).toBe(404);
  });

  it("an invalid body on another student's row is 400 (input before lookup)", async () => {
    const id = await seed(studentB, "scheduled", "future");
    expect((await apiA.patch(pathFor(id), { action: "delete" })).status).toBe(400);
  });

  it("a disallowed action on another student's row is 404, not 409 (no leak that it exists)", async () => {
    const id = await seed(studentB, "completed", "past");
    expect((await apiA.patch(pathFor(id), { action: "cancel" })).status).toBe(404);
  });
});

describe("input validation (400)", () => {
  it("invalid JSON", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const { status, body } = await apiA.patch(pathFor(id), undefined, { rawBody: "{not json" });
    expect(status).toBe(400);
    expect(errorOf(body).message).toBe("Request body must be valid JSON");
  });

  it.each([[{ action: "delete" }], [{}], [{ status: "completed" }]])("unknown or missing action: %j", async (body) => {
    const id = await seed(studentA, "scheduled", "future");
    expect((await apiA.patch(pathFor(id), body)).status).toBe(400);
  });

  it.each([[{ action: "cancel", status: "completed" }], [{ action: "complete", reason: "x" }]])(
    "extra keys: %j",
    async (body) => {
      const id = await seed(studentA, "scheduled", "past");
      const before = await readConsultationAsAdmin(id);
      expect((await apiA.patch(pathFor(id), body)).status).toBe(400);
      await expectUnchanged(id, before);
    },
  );
});

describe("concurrency (decision 9a: rules in the UPDATE's WHERE clause)", () => {
  it("two simultaneous cancels: exactly one 200 and one 409", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const results = await Promise.all([
      apiA.patch(pathFor(id), { action: "cancel" }),
      apiA.patch(pathFor(id), { action: "cancel" }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it("cancel racing reschedule never errors, and the row ends in a valid state", async () => {
    const id = await seed(studentA, "scheduled", "future");
    const results = await Promise.all([
      apiA.patch(pathFor(id), { action: "cancel" }),
      apiA.patch(pathFor(id), { action: "reschedule", scheduledAt: FAR_FUTURE }),
    ]);
    const statuses = results.map((result) => result.status).sort();
    // Reschedule keeps status "scheduled" and the time in the future, so if it wins first,
    // cancel can still succeed afterwards. Either way: no 500s, and the row ends up consistent.
    expect(statuses.every((code) => code === 200 || code === 409)).toBe(true);
    const row = await readConsultationAsAdmin(id);
    expect(["scheduled", "cancelled"]).toContain(row.status);
  });
});
