import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
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
        statements: 6.23,
        branches: 67.41,
        functions: 45.91,
        lines: 6.23,
        autoUpdate: false,
      },
    },
  },
});
