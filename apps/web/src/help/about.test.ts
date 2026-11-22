import { describe, expect, it } from "vitest";
import generated from "./generated.json";

/**
 * The «О программе» page is the one place the old name may stay as history (ADR-254,
 * `spec/rebrand.md` §1.5). This reads the bundle the help centre actually ships.
 */
interface Topic {
  id: string;
  title: Record<string, string>;
  summary: Record<string, string>;
  html: Record<string, string>;
}

const topics = (generated as unknown as { topics: Topic[] }).topics;
const about = topics.find((topic) => topic.id === "about.remo");

describe("the About page", () => {
  it("exists in both languages", () => {
    expect(about).toBeDefined();
    expect(about?.html.ru).toBeTruthy();
    expect(about?.html.en).toBeTruthy();
  });

  it("titles itself with the public name in the right case", () => {
    // «О Ремуке» is the prepositional case the Russian title needs (§4.3).
    expect(about?.title.ru).toContain("Ремук");
    expect(about?.title.en).toContain("Remuka");
  });

  it("shows the name and the one allowed history line", () => {
    expect(about?.html.ru).toContain("Ремука");
    expect(about?.html.ru).toContain("раньше remo");
    expect(about?.html.en).toContain("Remuka");
    expect(about?.html.en).toContain("formerly remo");
  });
});
