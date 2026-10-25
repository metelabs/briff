import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "packages/*/dist/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Server Action modules ("use server"): every export is a public endpoint, so only async
    // functions may be exported (src/test/use-server-exports.test.ts checks every such file).
    files: ["src/**/actions.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > VariableDeclaration",
          message: 'A "use server" module may only export async functions.',
        },
        {
          selector: "ExportNamedDeclaration > FunctionDeclaration[async=false]",
          message: 'A "use server" module may only export async functions.',
        },
        {
          selector: "ExportNamedDeclaration > ClassDeclaration",
          message: 'A "use server" module may only export async functions.',
        },
        {
          selector: "ExportNamedDeclaration[source]:not([exportKind='type'])",
          message: 'A "use server" module may not re-export values.',
        },
      ],
    },
  },
]);

export default eslintConfig;
