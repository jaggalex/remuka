import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RLS_TABLES } from "./rls-admin.mjs";
import { SCHEMA_VERSION } from "./schema-version.mjs";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const rls = readFileSync(new URL("./rls.sql", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../../scripts/rls-inventory.mjs", import.meta.url), "utf8");

const ddl = /create table if not exists consent_events \(([\s\S]*?)\n\);/.exec(schema)?.[1] ?? "";

describe("schema 29: the consent journal (ADR-255 §4)", () => {
  it("records who chose what, under which zone and policy edition", () => {
    expect(ddl).not.toBe("");
    expect(ddl).toContain("id uuid primary key default gen_random_uuid()");
    expect(ddl).toContain("user_id uuid references users (id) on delete cascade");
    expect(ddl).toContain("zone text not null check (zone in ('eu', 'ru'))");
    expect(ddl).toContain("choices jsonb not null");
    expect(ddl).toContain("policy_version text not null");
    expect(ddl).toContain("user_agent text");
    expect(ddl).toContain("ip_hash text");
    expect(ddl).toContain("created_at timestamptz not null default now()");
  });

  it("keeps choices an object and never necessary", () => {
    expect(ddl).toContain("check (jsonb_typeof(choices) = 'object')");
    // `necessary` cannot be a choice; the service drops it before it reaches the row.
    const code = ddl
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    expect(code).not.toContain("necessary");
  });

  it("indexes the only read: one account's recent choices", () => {
    expect(schema).toContain(
      "create index if not exists consent_events_user_idx\n  on consent_events (user_id, created_at desc)",
    );
  });

  it("is global identity, not a tenant table", () => {
    expect(RLS_TABLES).not.toContain("consent_events");
    expect(rls).toContain("`consent_events`");
    expect(rls).not.toContain("alter table consent_events");
    // The inventory's GLOBAL set is the second half of the same decision.
    const global = /const GLOBAL = new Set\(\[([\s\S]*?)\]\)/.exec(inventory)?.[1] ?? "";
    expect(global).toContain('"consent_events"');
  });

  it("is schema 37, and the version gate knows it", () => {
    expect(SCHEMA_VERSION).toBe(40);
    expect(schema).toContain("insert into schema_meta (id, version) values (1, 40)");
  });
});
