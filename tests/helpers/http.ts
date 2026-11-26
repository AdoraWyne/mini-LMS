import { createServerClient } from "@supabase/ssr";
import { testEnv } from "./env";
import type { TestUser } from "./users";

/**
 * HTTP helpers for API tests: real requests to the running app (`npm run dev`),
 * authenticated with real session cookies.
 */

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

export type ApiResult = {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or null if the body wasn't JSON. */
  body: unknown;
};

/** Fails fast with a clear message if the app isn't running, instead of N confusing fetch errors. */
export async function assertDevServerRunning(): Promise<void> {
  try {
    await fetch(BASE_URL, { redirect: "manual" });
  } catch {
    throw new Error(`API tests need the app running at ${BASE_URL}. Start it with \`npm run dev\` first.`);
  }
}

/**
 * Signs in the way the app does and returns the Cookie header value.
 *
 * Uses @supabase/ssr's own createServerClient with an in-memory cookie jar, so the
 * cookie name and format (e.g. `sb-127-auth-token=base64-...`, possibly chunked
 * into .0/.1) are exactly what the app expects. We never build the cookie by hand.
 */
export async function sessionCookieFor(user: TestUser): Promise<string> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(testEnv.supabaseUrl, testEnv.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`Sign-in as ${user.email} failed: ${error.message}`);
  if (jar.size === 0) throw new Error(`Sign-in as ${user.email} set no cookies`);

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

type RequestOptions = {
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as-is (e.g. invalid JSON). Overrides `body`. */
  rawBody?: string;
};

async function send(method: string, path: string, cookie: string | undefined, options: RequestOptions = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);

  let requestBody: string | undefined;
  if (options.rawBody !== undefined) requestBody = options.rawBody;
  else if (options.body !== undefined) requestBody = JSON.stringify(options.body);
  if (requestBody !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: requestBody,
    // Never follow redirects: if the proxy ever redirected /api again (decision 14),
    // tests must see the 307, not silently load the login page.
    redirect: "manual",
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body } satisfies ApiResult;
}

export type ApiClient = {
  get(path: string): Promise<ApiResult>;
  post(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<ApiResult>;
  patch(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<ApiResult>;
};

function clientWithCookie(cookie: string | undefined): ApiClient {
  return {
    get: (path) => send("GET", path, cookie),
    post: (path, body, options) => send("POST", path, cookie, { ...options, body }),
    patch: (path, body, options) => send("PATCH", path, cookie, { ...options, body }),
  };
}

export const api = {
  /** Signed in as `user` (real session cookie). */
  async as(user: TestUser): Promise<ApiClient> {
    return clientWithCookie(await sessionCookieFor(user));
  },
  /** No cookie: a logged-out visitor. */
  anon(): ApiClient {
    return clientWithCookie(undefined);
  },
  /** A specific Cookie header, e.g. a forged session. */
  withCookie(cookie: string): ApiClient {
    return clientWithCookie(cookie);
  },
};
