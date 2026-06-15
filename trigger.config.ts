import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["trigger"],
  runtime: "node",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  maxDuration: 3600,
  build: {
    // Keep the heavy Prisma + pg dependency graph out of the bundle. Without this,
    // esbuild re-bundles the entire generated client + driver adapters on every
    // dev watch rebuild, which leaks heap until the worker OOM-crashes. These are
    // available at runtime via node_modules, so they don't need bundling.
    external: [
      "@prisma/client",
      "@prisma/adapter-pg",
      "pg",
    ],
  },
});
