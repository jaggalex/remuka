import { describe, expect, it } from "vitest";
import {
  assertLegalDraftsFlag,
  assertLiveBillingAllowed,
  assertStage,
  internalMailHost,
  isStage,
  legalDraftsAllowed,
  liveBillingAllowed,
  mailAllowRecipients,
  recipientAllowed,
  stagePublicField,
  stageSubject,
} from "./stage.mjs";

/**
 * The stand flag has exactly one meaning: `REMO_STAGE=1`. Every consequence is off for
 * every other value, which is what keeps production safe when an operator half-configures
 * a stand (`spec/stage.md` §5).
 */
describe("the stage flag", () => {
  it("is true only for the literal 1", () => {
    expect(isStage({ REMO_STAGE: "1" })).toBe(true);
    expect(isStage({ REMO_STAGE: " 1 " })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", "stage", "2"]) {
      expect(isStage({ REMO_STAGE: value })).toBe(false);
    }
  });

  it("refuses a stand-only command without the flag", () => {
    expect(() => assertStage({}, "stage:seed")).toThrow(/only on a test stand/);
    expect(() => assertStage({ REMO_STAGE: "0" }, "stage:reset")).toThrow(/REMO_STAGE=1/);
    expect(() => assertStage({ REMO_STAGE: "1" }, "stage:seed")).not.toThrow();
  });

  it("publishes the stage field only on a stand", () => {
    expect(stagePublicField({ REMO_STAGE: "1" })).toBe(true);
    expect(stagePublicField({})).toBeUndefined();
    expect(stagePublicField({ REMO_STAGE: "0" })).toBeUndefined();
  });
});

describe("legal drafts", () => {
  it("needs both flags", () => {
    expect(legalDraftsAllowed({ REMO_STAGE: "1", REMO_LEGAL_ALLOW_DRAFTS: "1" })).toBe(true);
    expect(legalDraftsAllowed({ REMO_STAGE: "1" })).toBe(false);
    expect(legalDraftsAllowed({ REMO_LEGAL_ALLOW_DRAFTS: "1" })).toBe(false);
    expect(legalDraftsAllowed({ REMO_STAGE: "0", REMO_LEGAL_ALLOW_DRAFTS: "1" })).toBe(false);
  });

  it("stops a production start that copied the stand's drafts flag", () => {
    expect(() => assertLegalDraftsFlag({ REMO_LEGAL_ALLOW_DRAFTS: "1" })).toThrow(
      /only together with REMO_STAGE=1/,
    );
    expect(() =>
      assertLegalDraftsFlag({ REMO_STAGE: "1", REMO_LEGAL_ALLOW_DRAFTS: "1" }),
    ).not.toThrow();
    expect(() => assertLegalDraftsFlag({ REMO_LEGAL_ALLOW_DRAFTS: "0" })).not.toThrow();
  });
});

describe("the mail allow-list", () => {
  const env = {
    REMO_STAGE: "1",
    REMO_MAIL_ALLOW_RECIPIENTS: "person@example.com, @allowed.test, other.test",
  };

  it("is read only on a stand", () => {
    expect(mailAllowRecipients(env)).toEqual(["person@example.com", "allowed.test", "other.test"]);
    expect(mailAllowRecipients({ ...env, REMO_STAGE: "0" })).toEqual([]);
    expect(mailAllowRecipients({ REMO_STAGE: "1" })).toEqual([]);
  });

  it("accepts a listed address, a listed domain and refuses everything else", () => {
    const allow = mailAllowRecipients(env);
    expect(recipientAllowed("person@example.com", allow)).toBe(true);
    expect(recipientAllowed("PERSON@EXAMPLE.COM", allow)).toBe(true);
    expect(recipientAllowed("anyone@allowed.test", allow)).toBe(true);
    expect(recipientAllowed("anyone@sub.allowed.test", allow)).toBe(false);
    expect(recipientAllowed("anyone@other.test", allow)).toBe(true);
    expect(recipientAllowed("anyone@elsewhere.test", allow)).toBe(false);
    expect(recipientAllowed("not an address", allow)).toBe(false);
    expect(recipientAllowed("person@example.com", [])).toBe(false);
  });

  it("knows the stand's own catcher from a remote mail host", () => {
    for (const host of ["mail", "mailpit", "localhost", "127.0.0.1", "10.1.2.3", "192.168.1.4", "172.20.0.2"]) {
      expect(internalMailHost(host)).toBe(true);
    }
    for (const host of ["smtp.example.com", "8.8.8.8", "172.32.0.1"]) {
      expect(internalMailHost(host)).toBe(false);
    }
  });
});

describe("the stand's marks", () => {
  it("prefixes a subject in the letter's language and never doubles it", () => {
    expect(stageSubject("Сброс пароля", "ru")).toBe("[Стенд] Сброс пароля");
    expect(stageSubject("Reset your password", "en")).toBe("[Stage] Reset your password");
    expect(stageSubject("[Stage] Reset your password", "en")).toBe("[Stage] Reset your password");
  });
});

describe("live payments", () => {
  it("are allowed on production and refused on a stand", () => {
    expect(liveBillingAllowed({})).toBe(true);
    expect(liveBillingAllowed({ REMO_STAGE: "1" })).toBe(false);
    expect(() => assertLiveBillingAllowed("live", {})).not.toThrow();
    expect(() => assertLiveBillingAllowed("live", { REMO_STAGE: "1" })).toThrow(
      /live payment connections are refused/,
    );
    expect(() => assertLiveBillingAllowed("test", { REMO_STAGE: "1" })).not.toThrow();
  });
});
