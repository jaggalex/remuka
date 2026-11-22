import { describe, expect, it } from "vitest";
import { backupFilename } from "./backupFormat";

/**
 * The download name in the browser (ADR-254 §4.1).
 *
 * A new backup is `.remuka-backup.json`; files already on disk keep the old
 * `.remo-backup.json` name, and reading them is unaffected because import decides the
 * format from `manifest.format`, not from the name.
 */
describe("backupFilename", () => {
  it("reads the extended and the ASCII name", () => {
    expect(
      backupFilename(
        `attachment; filename="board.remuka-backup.json"; filename*=UTF-8''${encodeURIComponent("план-ёж.remuka-backup.json")}`,
      ),
    ).toBe("план-ёж.remuka-backup.json");
    expect(backupFilename('attachment; filename="plan.remuka-backup.json"')).toBe(
      "plan.remuka-backup.json",
    );
  });

  it("still reads a backup downloaded from 0.8.0", () => {
    expect(backupFilename('attachment; filename="plan.remo-backup.json"')).toBe(
      "plan.remo-backup.json",
    );
  });

  it("falls back to the public name when the header is missing", () => {
    expect(backupFilename("")).toBe("board.remuka-backup.json");
  });
});
