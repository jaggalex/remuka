import { describe, expect, it } from "vitest";
import { greetingKey } from "./homeGreeting";

describe("greetingKey", () => {
  it("greets the three parts of the day", () => {
    expect(greetingKey(0)).toBe("home.greeting.morning");
    expect(greetingKey(11)).toBe("home.greeting.morning");
    expect(greetingKey(12)).toBe("home.greeting.day");
    expect(greetingKey(17)).toBe("home.greeting.day");
    expect(greetingKey(18)).toBe("home.greeting.evening");
    expect(greetingKey(23)).toBe("home.greeting.evening");
  });
});
