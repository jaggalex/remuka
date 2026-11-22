import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { BRAND } from "@remo/brand";
import rootPackage from "../../package.json";

/**
 * The dev proxy can point at another sync instance, e.g. a test server on :1236.
 *
 * The config runs in Node but the web project deliberately has no Node types, so the
 * one environment variable it needs is read through a narrow cast instead of adding a
 * dependency for it.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const syncTarget = env?.REMO_SYNC_TARGET ?? "http://localhost:1234";
const syncWsTarget = syncTarget.replace(/^http/, "ws");

// Docker passes the release identity as build args; a local build falls back to the
// package version and a `dev` marker (ADR-179).
const version = env?.REMO_VERSION ?? rootPackage.version;
const build = env?.REMO_BUILD ?? "dev";
const commit = env?.REMO_COMMIT ?? "dev";

/**
 * The tab title before any script runs belongs to the brand, not to a literal in the
 * shell (ADR-254 §4.1). Vite injects it in development and in the build, so the English
 * spelling has one source (`spec/rebrand-fixes.md` §4, rule 3).
 */
function brandTitle() {
  return {
    name: "remo-brand-title",
    transformIndexHtml: () => [
      { tag: "title", children: BRAND.name.en, injectTo: "head" as const },
    ],
  };
}

export default defineConfig({
  plugins: [react(), brandTitle()],
  define: {
    __REMO_VERSION__: JSON.stringify(version),
    __REMO_BUILD__: JSON.stringify(build),
    __REMO_COMMIT__: JSON.stringify(commit),
  },
  server: {
    port: 5173,
    /**
     * The read API lives on the sync service (another origin), so it is proxied
     * through the dev server: the browser talks to its own origin and CORS never
     * enters the picture.
     */
    proxy: {
      // Both the read API and the live websocket go through the dev server, so a
      // teammate on another machine only needs this one port to reach everything.
      "/api": {
        target: syncTarget,
        // Keep the browser's `Host`: the CSRF origin check compares it with `Origin`,
        // and rewriting it to the upstream port would make every mutation look foreign
        // (ADR-062).
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/sync": {
        target: syncWsTarget,
        ws: true,
        rewrite: (path) => path.replace(/^\/sync/, ""),
      },
    },
  },
});
