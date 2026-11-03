// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig(
  { ignores: ["**/dist/", "**/node_modules/", "**/.wrangler/", "apps/backend/public/"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Ambient declaration files reference types with import(); there is no
    // import statement to turn into a type import.
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
  {
    files: ["backend/**/*.ts", "apps/backend/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@frontend/*", "@app/frontend/*"],
              message: "Backend code never imports frontend code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.tsx", "**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='React']",
          message: "Use named imports from 'react' instead of React.xxx.",
        },
        {
          // Feature packages are imported file by file; a barrel hides what a
          // module really depends on.
          selector: "ExportAllDeclaration",
          message:
            "Import the file you need directly instead of re-exporting through a barrel.",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
