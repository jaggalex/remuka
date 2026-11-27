import { readFileSync } from "node:fs";
import { briefPrompt } from "../apps/sync/agent-brief.mjs";
import { prepareTaskFile } from "../apps/sync/task-file.mjs";

// Use the API service's native module resolution for the provider payload.
const { intent, file, snapshot } = JSON.parse(readFileSync(0, "utf8"));
const prompt = briefPrompt({ intent, inputs: [prepareTaskFile(file)], snapshot });
process.stdout.write(prompt.user);
