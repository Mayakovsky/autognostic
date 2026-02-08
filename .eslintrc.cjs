module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": "warn",
  },
  ignorePatterns: ["dist/", "node_modules/", "*.js"],
  overrides: [
    {
      // Allow console in service files (intentional logging)
      files: [
        "src/services/**/*.ts",
        "src/index.ts",
        "src/actions/**/*.ts",
        "src/orchestrator/**/*.ts",
        "src/integration/**/*.ts",
        "src/providers/**/*.ts",
        "src/utils/**/*.ts",
      ],
      rules: {
        "no-console": "off",
      },
    },
  ],
};
