/**
 * API tests for GET /api/admin/consultations. Journeys: docs/user-journeys.md section 5.
 * Real HTTP to the running app (`npm run dev`) with real session cookies.
 *
 * The admin sees EVERY consultation, including your manual-testing data, so these tests
 * never assert exact totals or exact page contents. They check invariants instead:
 * our seeded rows are present somewhere, pages respect pageSize, are sorted, don't overlap.
 *
 * Test files run one after another (fileParallelism: false), so no other test file can
 * insert rows between two page requests. Booking something by hand mid-run still could:
 * that's the known weakness of offset pagination (cursor pagination = "with more time").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsultationDto } from "@/lib/api/mappers";
import type { ApiErrorBody, ApiSuccess } from "@/lib/api/http";
import { daysFromNow, seedConsultation } from "../helpers/fixtures";
import { api, assertDevServerRunning, BASE_URL, type ApiClient } from "../helpers/http";
import { cleanupTestUsers, createTestUser, type TestUser } from "../helpers/users";

const PATH = "/api/admin/consultations";

type AdminPage = {
  items: ConsultationDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

let studentA: TestUser;
let studentB: TestUser;
let adminUser: TestUser;
let apiA: ApiClient;
let apiAdmin: ApiClient;
let seededIds: string[];

beforeAll(async () => {
  await assertDevServerRunning();
  studentA = await createTestUser("student");
  studentB = await createTestUser("student");
  adminUser = await createTestUser("admin");
  apiA = await api.as(studentA);
  apiAdmin = await api.as(adminUser);

  // Two students, all three statuses, past and future.
  seededIds = [
    await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(2) }),
    await seedConsultation({ studentId: studentA.id, scheduledAt: daysFromNow(-2), status: "completed" }),
    await seedConsultation({ studentId: studentB.id, scheduledAt: daysFromNow(3), status: "cancelled" }),
    await seedConsultation({ studentId: studentB.id, scheduledAt: daysFromNow(-3) }),
  ];
});

afterAll(async () => {
  await cleanupTestUsers();
});

function pageOf(body: unknown): AdminPage {
  return (body as ApiSuccess<AdminPage>).data;
}

function errorOf(body: unknown): ApiErrorBody["error"] {
  return (body as ApiErrorBody).error;
}

/** Same order as the API: scheduledAt ascending, then id ascending (plain code-unit comparison, like Postgres). */
function comesBefore(a: ConsultationDto, b: ConsultationDto): boolean {
  if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt < b.scheduledAt;
  return a.id < b.id;
}

function expectSorted(items: ConsultationDto[]) {
  for (let i = 1; i < items.length; i += 1) {
    expect(comesBefore(items[i - 1], items[i])).toBe(true);
  }
}

/** Walks every page (pageSize 100) and returns all items. */
async function fetchAllPages(): Promise<ConsultationDto[]> {
  const all: ConsultationDto[] = [];
  for (let page = 1; ; page += 1) {
    const { status, body } = await apiAdmin.get(`${PATH}?page=${page}&pageSize=100`);
    expect(status).toBe(200);
    const result = pageOf(body);
    all.push(...result.items);
    if (page >= result.totalPages) return all;
  }
}

describe("access: 401 -> 403 -> 400", () => {
  it("logged out is 401, even with bad params", async () => {
    const { status, body } = await api.anon().get(`${PATH}?pageSize=1000`);
    expect(status).toBe(401);
    expect(body).toEqual({ error: { message: expect.any(String) } });
  });

  it("a forged session cookie is 401", async () => {
    expect((await api.withCookie("sb-127-auth-token=garbage").get(PATH)).status).toBe(401);
  });

  it("a student is 403, and gets no data", async () => {
    const { status, body } = await apiA.get(PATH);
    expect(status).toBe(403);
    expect(body).toEqual({ error: { message: "Admins only" } });
  });

  it("a student with bad params is still 403 (role before input)", async () => {
    expect((await apiA.get(`${PATH}?pageSize=1000`)).status).toBe(403);
  });
});

describe("query validation (400)", () => {
  it.each(["pageSize=1000", "pageSize=0", "page=0", "page=-1", "page=abc", "page=1.5", "sort=reason"])(
    "rejects ?%s",
    async (query) => {
      const { status, body } = await apiAdmin.get(`${PATH}?${query}`);
      expect(status).toBe(400);
      expect(errorOf(body).message).toBe("Invalid input");
    },
  );
});

describe("listing everything", () => {
  it("defaults to page 1, pageSize 20, and echoes them back", async () => {
    const { status, body } = await apiAdmin.get(PATH);
    expect(status).toBe(200);
    const result = pageOf(body);
    expect(result).toMatchObject({ page: 1, pageSize: 20 });
    expect(result.items.length).toBeLessThanOrEqual(20);
  });

  it("includes every student's consultations in every status", async () => {
    const all = await fetchAllPages();
    const found = all.filter((item) => seededIds.includes(item.id));
    expect(found.map((item) => item.id).sort()).toEqual([...seededIds].sort());
    expect(new Set(found.map((item) => item.studentId))).toEqual(new Set([studentA.id, studentB.id]));
    expect(new Set(found.map((item) => item.status))).toEqual(new Set(["scheduled", "completed", "cancelled"]));
  });

  it("returns camelCase fields only", async () => {
    const [first] = pageOf((await apiAdmin.get(PATH)).body).items;
    expect(Object.keys(first).sort()).toEqual(
      ["createdAt", "firstName", "id", "lastName", "reason", "scheduledAt", "status", "studentId", "updatedAt"].sort(),
    );
  });
});

describe("pagination", () => {
  it("pages respect pageSize, are sorted, don't overlap, and agree on totals", async () => {
    // We seeded 4 rows, so with pageSize 2 there are always at least 2 pages.
    const first = pageOf((await apiAdmin.get(`${PATH}?page=1&pageSize=2`)).body);
    const second = pageOf((await apiAdmin.get(`${PATH}?page=2&pageSize=2`)).body);

    expect(first.items).toHaveLength(2);
    expect(second.items.length).toBeGreaterThanOrEqual(1);
    expect(second.items.length).toBeLessThanOrEqual(2);

    expectSorted(first.items);
    expectSorted(second.items);
    expect(comesBefore(first.items[first.items.length - 1], second.items[0])).toBe(true);

    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);

    expect(first.total).toBe(second.total);
    expect(first.total).toBeGreaterThanOrEqual(seededIds.length);
    expect(first.totalPages).toBe(Math.ceil(first.total / 2));
    expect(second).toMatchObject({ page: 2, pageSize: 2 });
  });

  it("a page past the end is 200 with no items (the collection exists, that page is just empty)", async () => {
    const { totalPages } = pageOf((await apiAdmin.get(`${PATH}?pageSize=100`)).body);
    const { status, body } = await apiAdmin.get(`${PATH}?page=${totalPages + 1}&pageSize=100`);
    expect(status).toBe(200);
    expect(pageOf(body).items).toEqual([]);
  });
});

describe("read-only (decision: admin view is read-only)", () => {
  it.each(["POST", "PATCH", "DELETE", "PUT"])("%s is 405", async (method) => {
    const response = await fetch(`${BASE_URL}${PATH}`, { method, redirect: "manual" });
    expect(response.status).toBe(405);
  });
});
