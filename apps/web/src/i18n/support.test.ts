import { describe, expect, it } from "vitest";
import { enSupport } from "./en-support";
import { ruSupport } from "./ru-support";

/**
 * The consent line beside «Attach technical information» (`spec/rebrand-fixes.md` §3).
 *
 * It describes the same promise in both languages: the technical set goes to the support
 * chat, which may be a separate operator (ADR-250), and it is not kept in rooms or on the
 * application's servers. The earlier rebrand shortened this to «does not leave the
 * service», which is a different and false promise once Chatwoot holds the message.
 */
describe("the support consent line", () => {
  it("names the support chat and says where the data is not stored", () => {
    expect(ruSupport["support.technicalGranted"]).toContain("чат поддержки");
    expect(ruSupport["support.technicalGranted"]).toContain("не сохраняется в комнатах");
    expect(ruSupport["support.technicalGranted"]).toContain("на серверах приложения");

    expect(enSupport["support.technicalGranted"]).toContain("support chat");
    expect(enSupport["support.technicalGranted"]).toContain("not stored in your rooms");
    expect(enSupport["support.technicalGranted"]).toContain("application's servers");
  });

  it("needs no product name to make that promise", () => {
    for (const text of [ruSupport["support.technicalGranted"], enSupport["support.technicalGranted"]]) {
      expect(text).not.toContain("{product}");
      expect(text.toLowerCase()).not.toContain("remo");
    }
  });
});
