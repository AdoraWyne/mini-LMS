import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/tests", "@/tests/**", "tests/**", "**/tests", "**/tests/**"],
              message:
                "App code must not import from tests/ (it contains the service-role client). See CLAUDE.md decision 3.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
