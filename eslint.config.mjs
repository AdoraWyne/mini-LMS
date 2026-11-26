import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const TESTS_IMPORT_BAN = {
  group: ["@/tests", "@/tests/**", "tests/**", "**/tests", "**/tests/**"],
  message: "App code must not import from tests/ (it contains the service-role client). See CLAUDE.md decision 3.",
};

const eslintConfig = [
  // Global ignores (an object with only `ignores`): generated files, not our code.
  // ESLint 9 flat config doesn't skip .next/ on its own, so without this
  // `npm run lint` reports thousands of problems from Next's build output.
  { ignores: [".next/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Deny by default: NO file may import from tests/, except files inside tests/.
    // tests/helpers/admin-client.ts holds the service-role client (bypasses RLS),
    // so this keeps it out of app code, including folders that don't exist yet
    // (CLAUDE.md, decision 3).
    ignores: ["tests/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [TESTS_IMPORT_BAN] }],
    },
  },
  {
    // lib/api/schemas.ts is shared by the API routes AND the browser (the booking form validates
    // with the same zod schema), so it must stay free of server-only imports.
    // Flat config REPLACES a rule's options for matching files, so the tests/ ban is repeated here.
    files: ["lib/api/schemas.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            TESTS_IMPORT_BAN,
            {
              group: ["server-only", "next/headers", "next/server", "@/lib/supabase/*", "@/lib/api/auth", "node:*"],
              message:
                "lib/api/schemas.ts is shared with the browser: keep it free of server-only imports (zod only).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
