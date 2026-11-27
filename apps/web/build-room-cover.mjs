import { build } from "vite";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const dest = new URL("../sync/dist/", import.meta.url);
const [bundle] = await build({
  configFile: false, root, publicDir: false, logLevel: "warn",
  build: {
    target: "node22", write: false,
    lib: { entry: "src/roomCoverRender.ts", formats: ["es"], fileName: () => "room-cover.mjs" },
    rollupOptions: { external: ["yjs"] },
  },
});
const [{ code }] = bundle.output;
await mkdir(dest, { recursive: true });
// Parallel local tests can build the same code; workers must always see a complete module.
const temp = new URL(randomUUID() + ".tmp", dest);
await writeFile(temp, code);
await rename(temp, new URL("room-cover.mjs", dest));
