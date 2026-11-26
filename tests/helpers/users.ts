import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { admin } from "./admin-client";
import { testEnv } from "./env";

export type TestRole = "student" | "admin";

export type TestUser = {
  id: string;
  email: string;
  password: string;
  role: TestRole;
};

/*
 * Test user emails follow one recognisable pattern:
 *
 *   test-<runId>-<n>@example.test
 *
 * `.test` is a reserved TLD (RFC 2606), so these can never be real addresses.
 * If a run crashes before cleanup, find and remove leftovers in Studio with:
 *
 *   delete from auth.users where email like 'test-%@example.test';
 *
 * (on delete cascade removes their profiles and consultations too.)
 */
const runId = randomUUID().slice(0, 8);
let userCounter = 0;
const TEST_PASSWORD = "test-password-123!";

const createdUserIds: string[] = [];

/**
 * Setup only (uses `admin`). Creates a confirmed user (skips the Mailpit email),
 * and for role "admin" promotes the profile the signup trigger created.
 *
 * supabase-js returns { data, error } instead of throwing, so every call is checked:
 * setup must never fail silently.
 */
export async function createTestUser(role: TestRole = "student"): Promise<TestUser> {
  userCounter += 1;
  const email = `test-${runId}-${userCounter}@example.test`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createTestUser(${email}) failed: ${error.message}`);
  const id = data.user.id;
  createdUserIds.push(id);

  if (role === "admin") {
    // .select() returns the updated rows, so we can prove exactly one profile changed.
    const { data: rows, error: updateError } = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", id)
      .select("id");
    if (updateError) throw new Error(`Promoting ${email} to admin failed: ${updateError.message}`);
    if (rows.length !== 1) {
      throw new Error(`Promoting ${email} to admin updated ${rows.length} rows, expected 1`);
    }
  }

  return { id, email, password: TEST_PASSWORD, role };
}

/** A client with no session: what a logged-out visitor (`anon`) can do with the publishable key. */
export function asAnon(): SupabaseClient {
  return createClient(testEnv.supabaseUrl, testEnv.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(user: TestUser): Promise<SupabaseClient> {
  const client = asAnon();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`Sign-in as ${user.email} failed: ${error.message}`);
  return client;
}

/** Signs in with the publishable key, exactly like the browser would. For assertions. */
export async function asStudent(user: TestUser): Promise<SupabaseClient> {
  if (user.role !== "student") throw new Error(`asStudent() called with a ${user.role} user`);
  return signIn(user);
}

/** Signs in with the publishable key as an admin user. For assertions. */
export async function asAdmin(user: TestUser): Promise<SupabaseClient> {
  if (user.role !== "admin") throw new Error(`asAdmin() called with a ${user.role} user`);
  return signIn(user);
}

/** Cleanup only (uses `admin`). Deletes every user this run created; cascade removes their data. */
export async function cleanupTestUsers(): Promise<void> {
  const failures: string[] = [];
  for (const id of createdUserIds.splice(0)) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) failures.push(`${id}: ${error.message}`);
  }
  if (failures.length > 0) {
    throw new Error(`cleanupTestUsers failed for:\n${failures.join("\n")}`);
  }
}
