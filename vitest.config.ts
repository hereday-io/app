import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Edge-function helpers that are plain TS (no Deno-only imports) are
    // tested here too; Deno itself isn't installed in CI.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/_shared/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
