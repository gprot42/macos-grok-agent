import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // Global ignores
  {
    ignores: [
      "dist/**",
      "src-tauri/target/**",
      "node_modules/**",
      "*.min.js",
      "src-tauri/gen/**",
      "scripts/fix_base64.cjs",
      "scripts/fix_empty.cjs",
      "scripts/update_imagegen.cjs",
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript + React files
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.app.json",
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // TypeScript
      ...tsPlugin.configs["recommended"].rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports" },
      ],

      // React
      ...reactPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // React 17+ JSX transform
      "react/prop-types": "off", // TypeScript handles this

      // React Hooks
      ...reactHooks.configs.recommended.rules,

      // React Refresh
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // General
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
    },
    settings: {
      react: { version: "detect" },
    },
  },

  // Config / script files (looser rules)
  {
    files: ["*.config.{js,ts}", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
    },
  },

  // Test files
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },

  // Disable formatting rules (handled by Prettier)
  prettierConfig,
];
