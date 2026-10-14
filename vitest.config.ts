import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // supabase/functions: edge-function modules kept free of Deno globals
    // so they can be tested here (see stripe-webhook/handlers.ts).
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
