import { Worker } from "node:worker_threads";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { pickVariant } from "./files-api.mjs";
import { fileKey } from "./files-store.mjs";
import { DEFAULT_MAX_PIXELS } from "./files-image.mjs";
import { Y } from "./y.mjs";

/** No file path or URL supplied by the document ever reaches the image decoder. */
async function roomImages(store, fileStore, orgId, boardId, ids, signal) {
  const images = [];
  // Bound the combined decoded image area when a cover contains many photographs.
  const side = Math.max(1, Math.min(640, Math.floor(Math.sqrt(4_000_000 / Math.max(1, ids.length)))));
  for (const id of ids) {
    signal.throwIfAborted();
    if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) continue;
    const row = await store.fileById(id);
    if (!row || row.status !== "ready" || row.org_id !== orgId || !await store.fileUsedInBoard(id, boardId)) continue;
    try {
      const variant = pickVariant(row.variants, "w256");
      if (!variant) continue;
      const thumbnail = sharp({ limitInputPixels: DEFAULT_MAX_PIXELS })
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).png();
      const source = await fileStore.get(fileKey(orgId, id, variant.name));
      const [, bytes] = await Promise.all([pipeline(source, thumbnail, { signal }), thumbnail.toBuffer()]);
      images.push([id, bytes]);
    } catch { /* A missing variant is rendered as unavailable. */ }
  }
  return images;
}

export async function encodeRoomCover(state, readImages) {
  const worker = new Worker(new URL("./room-cover-thread.mjs", import.meta.url), { execArgv: [] });
  const controller = new AbortController();
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("room cover timed out")), 45_000);
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error("room cover worker exited early")));
      worker.on("message", async (result) => {
        if (result.error) return reject(new Error(result.error));
        if (result.data) return resolve(Buffer.from(result.data));
        try { worker.postMessage({ files: await readImages(result.fileIds, controller.signal) }); }
        catch (error) { reject(error); }
      });
      worker.postMessage({ state });
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await worker.terminate();
  }
}

export function createRoomCovers({ store, fileStore, log = console }) {
  let timer;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const { id, org_id: orgId } of await store.dueRoomCovers(8)) {
        try {
          const claim = await store.withTenant(orgId, () => store.claimRoomCover(id));
          if (!claim) continue;
          const doc = new Y.Doc();
          let state;
          try {
            await store.withTenant(orgId, () => store.loadRoomStateInTenant(id, doc));
            state = Y.encodeStateAsUpdate(doc);
          } finally { doc.destroy(); }
          const data = await encodeRoomCover(state, (ids, signal) =>
            store.withTenant(orgId, () => roomImages(store, fileStore, orgId, id, ids, signal)));
          await store.withTenant(orgId, () => store.publishRoomCover(id, claim, data));
        } catch (error) { log.error("[room-cover] render failed", id, error.message); }
      }
    } catch (error) { log.error("[room-cover] scan failed", error.message); }
    finally { running = false; }
  }
  return {
    tick,
    start() { timer ??= setInterval(() => void tick(), 15_000); timer.unref(); },
    stop() { clearInterval(timer); timer = undefined; },
  };
}
