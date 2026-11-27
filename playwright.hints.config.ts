import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// This suite changes installation-wide words. A separate run owns a separate database.
export default defineConfig({ ...base, testDir: "./acceptance/hints", testMatch: "**/*.spec.ts" });
