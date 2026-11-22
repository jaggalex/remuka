import { describe, expect, it } from "vitest";
import { backupDisposition } from "./sync-export.mjs";

/**
 * The public name of a backup file (ADR-254 §4.1).
 *
 * The format id inside the file stays `remo.board`, and the import route never looks at
 * the filename, so a `.remo-backup.json` from 0.8.0 still opens. Only the suggested name
 * a person sees changes.
 */
describe("backup file name", () => {
  it("uses the public name and keeps an ASCII fallback", () => {
    expect(backupDisposition("Plan")).toBe('attachment; filename="plan.remuka-backup.json"');
    expect(backupDisposition("план-ёж")).toBe(
      `attachment; filename="board.remuka-backup.json"; filename*=UTF-8''${encodeURIComponent("план-ёж.remuka-backup.json")}`,
    );
  });

  it("never suggests the old file name", () => {
    for (const title of ["Plan", "план-ёж", "", "..."]) {
      expect(backupDisposition(title)).not.toContain(".remo-backup.json");
    }
  });
});
