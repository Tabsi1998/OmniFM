// ESLint for the bot, the scripts, the tests and the React frontend (#209).
// Findings that existed when the linter came in are debt in the "eslint" list
// of scripts/ci-baseline.json; `npm run lint` (scripts/check-lint.mjs) fails
// on every new one.
import js from "@eslint/js";
import globals from "globals";
import nodePlugin from "eslint-plugin-n";
import promisePlugin from "eslint-plugin-promise";
import reactHooks from "eslint-plugin-react-hooks";

const sharedRules = {
  "no-unused-vars": ["error", {
    args: "after-used",
    argsIgnorePattern: "^_",
    caughtErrors: "none",
    ignoreRestSiblings: true,
  }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-constant-condition": ["error", { checkLoops: false }],
  // The code already marks intended sequential awaits with a disable comment.
  "no-await-in-loop": "error",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "frontend/build/**",
      "frontend/dist/**",
      "frontend/vite.config.js",
      "backend/**",
      ".local-testing/**",
      "logs/**",
      "runtime-data/**",
      "test_reports/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,mjs}", "scripts/**/*.{js,mjs}", "test/**/*.{js,mjs}", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    plugins: { n: nodePlugin, promise: promisePlugin },
    rules: {
      ...sharedRules,
      "n/no-deprecated-api": "error",
      "n/no-missing-import": "error",
      "n/no-process-exit": "off",
      "promise/no-new-statics": "error",
      "promise/no-return-wrap": "error",
      "promise/param-names": "error",
      "promise/valid-params": "error",
    },
  },
  {
    files: ["frontend/src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...sharedRules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
