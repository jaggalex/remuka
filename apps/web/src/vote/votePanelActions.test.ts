import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Widget } from "@remo/model";
import { I18nProvider } from "../i18n";
import { VoteHistory } from "./VoteHistory";
import { VoteManage } from "./VoteManage";
import { VoteResults } from "./VoteResults";
import type { VoteSession } from "./voteTypes";

const session: VoteSession = {
  id: "vote", boardId: "room", createdBy: "owner", createdByName: "Host",
  state: "ended", anonymous: true, objectIds: ["line"], votesPerSubject: 3,
  remaining: 2, myVotes: 1, myObjectIds: ["line"], voters: 1,
  votes: [{ object_id: "line", votes: 1 }], publishedAt: null, endsAt: null,
  createdAt: "2026-11-26T15:00:00Z", endedAt: "2026-11-26T15:05:00Z", serverNow: "2026-11-26T15:05:00Z",
};
const note: Widget = { id: "note", type: "sticky_note", parentId: null, x: 0, y: 0, width: 100, height: 100 };
const line: Widget = { ...note, id: "line", type: "connector", start: { item: "note" }, end: { item: "end" } };
const noop = () => {};

beforeEach(() => { vi.stubGlobal("window", { location: { search: "?lang=en" } }); });
afterEach(() => { vi.unstubAllGlobals(); });

function render(child: ReactElement) {
  return renderToStaticMarkup(h(I18nProvider, { children: child }));
}

it("reserves new-session actions for facilitators while keeping results and history readable", () => {
  for (const canFacilitate of [true, false]) {
    const props = { widgets: [line], canFacilitate, busy: false, onPublish: noop, onNewSession: noop };
    const results = render(h(VoteResults, { ...props, session, publishedObjectId: null, onReveal: noop }));
    const history = render(h(VoteHistory, { ...props, sessions: [], onOpenResults: noop }));
    expect(results).toContain("vote-results-list");
    for (const surface of [results, history]) {
      expect(surface.includes(">New session<")).toBe(canFacilitate);
    }
  }
});

it("enables the camera action only if at least one session object can be drawn", () => {
  const end: Widget = { ...note, id: "end", x: 1600 };
  const running = { ...session, state: "open" as const, endedAt: null };
  const button = (widgets: Widget[], objectIds: string[]) => {
    const html = render(h(VoteManage, { session: { ...running, objectIds }, widgets,
      canFacilitate: false, busy: false, left: null, pinnedToTimer: false,
      onEnd: noop, onExtend: noop, onReveal: noop, onRevealSession: noop }));
    const markup = html.match(/<button\b[^>]*><span[^>]*>Show session objects in the room<\/span><\/button>/)?.[0];
    expect(markup).toBeDefined();
    return markup!;
  };
  expect(button([note, line], ["line"])).toContain("disabled");
  expect(button([note, line, end], ["line"])).not.toContain("disabled");
  expect(button([note, line], ["line", "note"])).not.toContain("disabled");
});

it("attributes a live anonymous session to its host and names a shared deadline only when pinned", () => {
  for (const pinnedToTimer of [true, false]) {
    const html = render(h(VoteManage, { session: { ...session, state: "open", endedAt: null },
      widgets: [note], canFacilitate: false, busy: false, left: 252_000, pinnedToTimer,
      onEnd: noop, onExtend: noop, onReveal: noop, onRevealSession: noop }));
    expect(html).toContain("led by Host");
    expect(html.includes("ends with the room timer")).toBe(pinnedToTimer);
    expect(html).not.toContain("End now");
  }
});
