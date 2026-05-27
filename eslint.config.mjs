import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import { defineConfig } from "eslint/config";

export default defineConfig([
  /**
   * Ignore generated/build files
   */
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
    ],
  },

  /**
   * Main backend source files
   */
  {
    files: ["src/**/*.{ts,js,mjs,cjs}"],

    languageOptions: {
      globals: globals.node,
      ecmaVersion: "latest",
      sourceType: "module",
    },

    plugins: {
      import: importPlugin,
      "unused-imports": unusedImports,
    },

    rules: {
      /**
       * Turn off duplicate unused-vars checking
       * because unused-imports handles it better
       */
      "@typescript-eslint/no-unused-vars": "off",

      /**
       * Remove unused imports automatically
       */
      "unused-imports/no-unused-imports": "error",

      /**
       * Catch unused variables
       */
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      /**
       * Import organization
       */
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],

          "newlines-between": "always",

          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      /**
       * Allow console for backend
       */
      "no-console": "off",

      /**
       * Safer equality
       */
      eqeqeq: ["error", "always"],

      /**
       * Temporarily relax explicit any
       * for faster backend development
       */
      "@typescript-eslint/no-explicit-any": "warn",

      /**
       * Relax empty object typing
       */
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },

  /**
   * Jest/Test files
   */
  {
    files: [
      "src/**/*.test.{ts,js}",
      "src/tests/**/*.{ts,js}",
      "**/*.spec.{ts,js}",
    ],

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },

    rules: {
      /**
       * Tests often need flexible typing
       */
      "@typescript-eslint/no-explicit-any": "off",

      /**
       * Allow require in tests
       */
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  /**
   * Jest config file
   */
  {
    files: ["jest.config.js"],

    languageOptions: {
      globals: globals.node,
    },
  },

  /**
   * Base configs
   */
  js.configs.recommended,
  ...tseslint.configs.recommended,
]);