import { defineConfig } from "vitest/config";
import path from "path";

const repoRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "@": path.resolve(repoRoot, "frontend", "src"),
      "@shared": path.resolve(repoRoot, "shared"),
    },
  },
  test: {
    environment: "node",
    // `shared/` holds the contracts both sides parse against, so its tests
    // belong to the same run as the server suite.
    include: [
      "backend/**/*.test.ts",
      "backend/**/*.spec.ts",
      "shared/**/*.test.ts",
      "shared/**/*.spec.ts",
      // Only the browser-free modules (pure helpers such as the evidence
      // buffer); rendering components would need a DOM environment.
      "frontend/src/lib/**/*.test.ts",
    ],
  },
});
