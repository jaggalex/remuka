import { parentPort } from "node:worker_threads";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { coverScene } from "./dist/room-cover.mjs";

let scene;
parentPort.on("message", async (job) => {
  try {
    if (job.state) {
      scene = coverScene(job.state);
      parentPort.postMessage({ fileIds: scene.fileIds });
      return;
    }
    const images = new Map();
    for (const [id, bytes] of job.files) {
      try { images.set(id, await loadImage(Buffer.from(bytes))); } catch { /* painter shows unavailable */ }
    }
    const canvas = createCanvas(scene.width, scene.height);
    scene.paint(canvas.getContext("2d"), images);
    for (const quality of [82, 65, 45, 25]) {
      const data = await canvas.encode("webp", quality);
      if (data.length <= 150 * 1024) {
        parentPort.postMessage({ data });
        return;
      }
    }
    throw new Error("cover exceeds byte limit");
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
