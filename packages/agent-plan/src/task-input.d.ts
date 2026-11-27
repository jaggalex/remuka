export type TaskFileKind = "md" | "txt" | "csv";
export interface PreparedInput {
  source: "file" | "text";
  name: string;
  kind: TaskFileKind | "text";
  content: string;
  chars: number;
  bytes: number;
  truncated: boolean;
  truncation_code: string | null;
}
export const TASK_INPUT_LIMITS: Readonly<{ bytes: number; chars: number; name: number; cell: number }>;
export class TaskInputError extends Error { readonly code: string; constructor(code: string, message: string); }
export function parseCsv(text: string): string[][];
export function csvToText(text: string): string;
export function prepareTaskFile(input: {name: string; content: string}): PreparedInput & {source: "file"; kind: TaskFileKind};
export function prepareTaskText(input: string): PreparedInput & {source: "text"; kind: "text"};
export function prepareTaskInputs(input?: {text?: string; file?: {name: string; content: string}}): {
  inputs: PreparedInput[];
  meta: Partial<Record<"text" | "file", { name: string; kind: string; chars: number; bytes: number; truncated: boolean; truncationCode?: string }>>;
};
