import { prepareTaskFile, TASK_INPUT_LIMITS, TaskInputError } from "@remo/agent-plan/task-input";
import type { TaskFileKind } from "@remo/agent-plan/task-input";
import type { TranslationKey } from "./i18n";

export { TASK_INPUT_LIMITS as TASK_FILE_LIMITS, TaskInputError as TaskFileError };
export interface TaskFile {
  name: string;
  kind: TaskFileKind;
  content: string;
  modelText: string;
  bytes: number;
  chars: number;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Keep the upload unchanged. The preview uses the server's CSV and truncation rules. */
export function prepareAgentFile(name: string, content: string): TaskFile {
  const file = prepareTaskFile({ name, content });
  const original = content.startsWith("\uFEFF") ? content.slice(1) : content;
  return {
    name: file.name, kind: file.kind, bytes: file.bytes, content: original, chars: original.length,
    modelText: file.content.slice(0, TASK_INPUT_LIMITS.chars),
  };
}

const FILE_ERROR_KEYS: Record<string, TranslationKey> = {
  BAD_FILE: "agents.file.bad",
  BAD_FILE_NAME: "agents.file.badName",
  BAD_FILE_TYPE: "agents.file.badType",
  BAD_FILE_ENCODING: "agents.file.badEncoding",
  FILE_TOO_LARGE: "agents.file.tooLarge",
  BAD_CSV: "agents.file.badCsv",
  BAD_TEXT: "agents.file.badText",
};

/** A code from the browser check or the API, in the words a person can act on. */
export function taskFileErrorText(
  code: string,
  t: (key: TranslationKey) => string,
): string {
  return t(FILE_ERROR_KEYS[code] ?? "agents.file.bad");
}

/** Human size for the field summary: no dependency, one decimal at most. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
