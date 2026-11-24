/**
 * EN strings — the tidy header, the people group and the account menu (ADR-266).
 *
 * Split by domain so the core table stays under the size ratchet; one flat namespace
 * and `keyof typeof en` still make a missing translation a type error.
 */
export const enChrome = {
  "board.exportForbidden": "Only room members can export it",
  "board.importForbidden": "Only room members can restore it",
  "board.appsUnavailable": "Apps live in a team — this room has none",
  "board.markMenu": "Remuka: account and rooms",
  "facilitation.vote.chip": "Votes: {n}",
  "people.trigger": "People in the room: {n}",
  "people.title": "In the room",
  "people.you": "you",
  "people.roleUnknown": "Room access",
  "people.followers": "Followers: {n}",
  "people.watchingOne": "and {n} guest is watching",
  "people.watchingFew": "and {n} guests are watching",
  "people.watchingMany": "and {n} guests are watching",
  "roomAgent.menu": "Agent",
  "roomAgent.menuOpen": "Give the agent a task",
  "role.guest": "Guest",
};
