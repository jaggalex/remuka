import { describe, expect, it } from "vitest";
import { requestSource, routeLabel } from "./http-route.mjs";

describe("the HTTP request source", () => {
  it("marks a bearer-token request as an agent and everything else as a user", () => {
    // Agents and integrations carry `remo_it_…` tokens; a person carries a session cookie.
    expect(requestSource({ authorization: "Bearer remo_it_abc" })).toBe("agent");
    expect(requestSource({ authorization: "bearer remo_it_abc" })).toBe("agent");
    expect(requestSource({ authorization: "  Bearer   remo_it_abc  " })).toBe("agent");
    expect(requestSource({})).toBe("user");
    expect(requestSource(undefined)).toBe("user");
    expect(requestSource({ authorization: "" })).toBe("user");
    // The header alone, without a token, is not an authenticated agent.
    expect(requestSource({ authorization: "Bearer" })).toBe("user");
    expect(requestSource({ authorization: "Bearer   " })).toBe("user");
    expect(requestSource({ authorization: "Basic dXNlcjpwYXNz" })).toBe("user");
    expect(requestSource({ cookie: "remo_session=abc" })).toBe("user");
  });
});

describe("the HTTP route label", () => {
  it("keeps a fixed name for the families the service serves", () => {
    expect(routeLabel("/")).toBe("/");
    expect(routeLabel("/health")).toBe("/health");
    expect(routeLabel("/boards")).toBe("/boards");
    expect(routeLabel("/boards/abc")).toBe("/boards/:id");
    expect(routeLabel("/boards/abc/access")).toBe("/boards/:id");
    expect(routeLabel("/auth/login")).toBe("/auth/login");
    expect(routeLabel("/auth")).toBe("/auth");
    expect(routeLabel("/orgs/abc/boards")).toBe("/orgs");
    expect(routeLabel("/agent/change-sets/abc")).toBe("/agent");
  });

  it("does not make a series of a caller's string under /auth", () => {
    expect(routeLabel("/auth/random-1")).toBe("/auth/other");
    expect(routeLabel("/auth/random-2")).toBe("/auth/other");
    expect(routeLabel(`/auth/${"x".repeat(10_000)}`)).toBe("/auth/other");
    for (const route of ["register", "logout", "me", "sessions", "preferences", "password"]) {
      expect(routeLabel(`/auth/${route}`)).toBe(`/auth/${route}`);
    }
  });

  it("collapses every unknown path into one bucket", () => {
    // The path is caller-controlled; a series per path would grow the registry.
    expect(routeLabel("/random-1")).toBe("other");
    expect(routeLabel("/random-2")).toBe("other");
    expect(routeLabel(`/${"x".repeat(10_000)}`)).toBe("other");
    expect(routeLabel("/boards/abc/../../etc/passwd")).toBe("/boards/:id");
  });
});
