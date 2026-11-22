import { describe, expect, it } from "vitest";
import {
  daysUntilEffective,
  legalUpcomingSessionKey,
  upcomingRevision,
  LEGAL_UPCOMING_DAYS,
} from "./legalUpcoming";

const EFFECTIVE = "2027-01-31";

function daysBefore(days: number): Date {
  return new Date(Date.parse(`${EFFECTIVE}T00:00:00Z`) - days * 86_400_000);
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    doc: "consent",
    version: 2,
    reaccept: true,
    effective: EFFECTIVE,
    accepted: false,
    url: "https://app.remuka.ru/legal/consent",
    ...overrides,
  };
}

describe("the 30-day banner (ADR-256 §5)", () => {
  it("appears exactly from the window's edge and not one day earlier", () => {
    expect(upcomingRevision([document()], daysBefore(31))).toBeNull();
    expect(upcomingRevision([document()], daysBefore(LEGAL_UPCOMING_DAYS))).toMatchObject({
      daysUntil: 30,
    });
  });

  it("is quiet on the effective day and after it: the blocking window takes over", () => {
    expect(upcomingRevision([document()], daysBefore(0))).toBeNull();
    expect(upcomingRevision([document()], daysBefore(-1))).toBeNull();
    expect(daysUntilEffective(EFFECTIVE, daysBefore(0))).toBe(0);
  });

  it("does not announce a revision the person already accepted", () => {
    expect(upcomingRevision([document({ accepted: true })], daysBefore(10))).toBeNull();
    expect(upcomingRevision([document()], daysBefore(10))).not.toBeNull();
  });

  it("skips documents that do not ask again and ones without a date", () => {
    expect(upcomingRevision([document({ reaccept: false })], daysBefore(10))).toBeNull();
    expect(upcomingRevision([document({ effective: null })], daysBefore(10))).toBeNull();
  });

  it("uses a session key that changes with the revision", () => {
    expect(legalUpcomingSessionKey(document())).toBe("remo.legal.upcoming.consent@2");
    expect(legalUpcomingSessionKey(document({ version: 3 }))).toBe(
      "remo.legal.upcoming.consent@3",
    );
  });
});
