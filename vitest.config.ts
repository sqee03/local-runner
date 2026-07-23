import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.spec.ts", "src/**/*.spec.ts"],
    exclude: ["injections/**", ".tmp/**", "release/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      exclude: ["injections/**", ".tmp/**", "release/**", "dist/**", "node_modules/**"]
    }
  }
});
