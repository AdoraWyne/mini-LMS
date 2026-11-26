import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Read a dotenv file with Node's built-in parser (no extra dependency).
// Missing files are fine here; tests/helpers/env.ts validates what's required.
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

export default defineConfig({
  resolve: {
    // Same "@/..." alias as tsconfig.json.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Run test FILES one after another. They share one local database, so a parallel file
    // inserting bookings could shift offset-pagination pages between two admin requests
    // and make the "pages don't overlap" check flaky.
    fileParallelism: false,
    // Tests talk to the real local Supabase over HTTP, so allow a bit more than the 5s default.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    env: {
      // App config (URL + publishable key), shared with `next dev`.
      ...readEnvFile(".env.local"),
      // Test-only secrets (service-role key). Never loaded by the app.
      ...readEnvFile(".env.test.local"),
    },
  },
});
