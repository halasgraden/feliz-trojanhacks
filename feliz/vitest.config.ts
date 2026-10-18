import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@feliz/db": path.join(root, "packages/db/src/index.ts"),
      "@feliz/rag": path.join(root, "packages/rag/src/index.ts"),
      "@feliz/routing": path.join(root, "packages/routing/src/index.ts"),
      "@feliz/agent": path.join(root, "packages/agent/src/index.ts"),
    },
  },
});
