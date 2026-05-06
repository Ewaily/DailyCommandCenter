import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [["tests/frontend/**", "happy-dom"]],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/frontend/main.ts",
        "src/server/index.ts",
      ],
      all: true,
      clean: true,
      thresholds: {
        statements: 13.13,
        branches: 70.96,
        functions: 52.6,
        lines: 13.13,
        autoUpdate: false,
      },
    },
  },
});
