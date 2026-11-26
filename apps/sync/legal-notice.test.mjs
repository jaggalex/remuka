/**
 * The scheduled legal notice (ADR-256 §5).
 *
 * Two nightly passes over the same revision and the same people must leave exactly one
 * letter per person: the dedupe key in `mail_outbox.params` is the whole guarantee, so the
 * test drives the pass twice with a store that behaves like the outbox.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGAL_NOTICE_DAYS,
  createLegalNoticeLoop,
  legalNoticeDays,
  legalNoticeDue,
  legalNoticeKey,
  queueLegalNotices,
} from "./legal-notice.mjs";

const EFFECTIVE = "2027-01-31"; // 30 days after the first pass below
const NIGHT_ONE = new Date("2027-01-01T03:00:00Z");
const NIGHT_TWO = new Date("2027-01-02T03:00:00Z");
const KEK = { key: Buffer.alloc(32, 7), id: "test" };
const MAIL = { driver: "console" };

const users = [
  { id: "u-1", email: "anna@example.test", name: "Анна", lang: "ru" },
  { id: "u-2", email: "john@example.test", name: "John", lang: "en" },
];

const document = (overrides = {}) => ({
  doc: "consent",
  zone: "ru",
  version: 2,
  title: { ru: "Согласие", en: "Consent" },
  changes: { ru: "Обновили сроки.", en: "We updated the deadlines." },
  status: "published",
  reaccept: true,
  effective: EFFECTIVE,
  url: "https://app.remuka.ru/legal/consent",
  ...overrides,
});

function memoryStore() {
  const queued = [];
  return {
    queued,
    async listActiveUsersForLegalNotice() {
      return users;
    },
    async existingLegalNoticeKeys(keys) {
      const present = new Set(
        queued.map((row) => row.params?.dedupe).filter((key) => keys.includes(key)),
      );
      return present;
    },
    async enqueueMail(row) {
      queued.push(row);
      return { id: row.id };
    },
  };
}

describe("the notice window", () => {
  it("defaults to 30 days and refuses a value that is not a day count", () => {
    expect(DEFAULT_LEGAL_NOTICE_DAYS).toBe(30);
    expect(legalNoticeDays({})).toBe(30);
    expect(legalNoticeDays({ REMO_LEGAL_NOTICE_DAYS: "45" })).toBe(45);
    expect(() => legalNoticeDays({ REMO_LEGAL_NOTICE_DAYS: "month" })).toThrow(/whole number/);
  });

  it("opens at the edge, stays quiet after the effective day, and never sends a draft", () => {
    expect(legalNoticeDue(document(), { today: new Date("2027-01-01T00:00:00Z") })).toEqual({
      effective: EFFECTIVE,
      daysUntil: 30,
    });
    expect(legalNoticeDue(document(), { today: NIGHT_ONE })).not.toBeNull();
    expect(
      legalNoticeDue(document(), { today: new Date("2027-02-01T00:00:00Z") }),
    ).toBeNull();
    expect(
      legalNoticeDue(document({ status: "draft" }), { today: NIGHT_ONE }),
    ).toBeNull();
    expect(
      legalNoticeDue(document({ reaccept: false }), { today: NIGHT_ONE }),
    ).toBeNull();
  });
});

describe("the daily pass (§5)", () => {
  it("queues one letter per person on the first night and none on the second", async () => {
    const store = memoryStore();
    const legal = { documents: [document()] };

    const first = await queueLegalNotices({
      store,
      legal,
      mailConfig: MAIL,
      env: {},
      now: () => NIGHT_ONE,
      kek: KEK,
      log: { log() {} },
    });
    const second = await queueLegalNotices({
      store,
      legal,
      mailConfig: MAIL,
      env: {},
      now: () => NIGHT_TWO,
      kek: KEK,
      log: { log() {} },
    });

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(store.queued.map(row => row.params.changes)).toEqual(["Обновили сроки.", "We updated the deadlines."]);
    expect(store.queued).toHaveLength(2);
    expect(store.queued.map((row) => row.params.dedupe).sort()).toEqual([
      "legal:consent:2:u-1",
      "legal:consent:2:u-2",
    ]);
    expect(store.queued.every((row) => row.template === "legal_update")).toBe(true);
  });

  it("a new revision is a new key and therefore a new letter", async () => {
    const store = memoryStore();
    await queueLegalNotices({
      store,
      legal: { documents: [document()] },
      mailConfig: MAIL,
      env: {},
      now: () => NIGHT_ONE,
      kek: KEK,
      log: { log() {} },
    });
    await queueLegalNotices({
      store,
      legal: { documents: [document({ version: 3 })] },
      mailConfig: MAIL,
      env: {},
      now: () => NIGHT_TWO,
      kek: KEK,
      log: { log() {} },
    });
    expect(store.queued).toHaveLength(4);
    expect(legalNoticeKey(document({ version: 3 }), "u-1")).toBe("legal:consent:3:u-1");
  });

  it("does not send a draft even when the test stand allows drafts", async () => {
    const store = memoryStore();
    const queued = await queueLegalNotices({
      store,
      legal: { documents: [document({ status: "draft" })] },
      mailConfig: MAIL,
      env: { REMO_LEGAL_ALLOW_DRAFTS: "1" },
      now: () => NIGHT_ONE,
      kek: KEK,
      log: { log() {} },
    });
    expect(queued).toBe(0);
    expect(store.queued).toEqual([]);
  });
});

describe("the loop", () => {
  it("runs at most once at a time and reports zero when mail is off", async () => {
    const store = memoryStore();
    const loop = createLegalNoticeLoop({
      store,
      legal: { documents: [document()] },
      mailConfig: { driver: "disabled" },
      now: () => NIGHT_ONE,
      kek: KEK,
      log: { log() {}, error() {} },
    });
    expect(await loop.runOnce()).toBe(0);
    expect(store.queued).toEqual([]);
    loop.stop();
  });
});
