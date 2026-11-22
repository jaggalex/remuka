/**
 * The stand commands load their configuration as data, never as shell.
 *
 * `deploy/remo` already refuses to `source` an environment file, and these commands run
 * beside it: a value is `KEY=VALUE`, an existing variable wins, and nothing is executed.
 * The first readable candidate is the instance file the release controller names; the
 * checkout's `.env` is the development fallback.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1);
  }
  return text;
}

export function applyEnvFile(env, file) {
  if (!file || !existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (env[key] !== undefined) continue;
    env[key] = unquote(raw);
  }
  return true;
}

/** Fill missing variables from the instance's production.env, then the checkout's .env. */
export function loadStageEnvironment(env = process.env) {
  const candidates = [
    String(env.REMO_PRODUCTION_ENV ?? "").trim(),
    env.REMO_DEPLOY_ROOT
      ? join(String(env.REMO_DEPLOY_ROOT), "shared", "production.env")
      : "",
    join(ROOT, ".env"),
  ];
  for (const file of candidates) {
    if (applyEnvFile(env, file)) return file;
  }
  return null;
}
