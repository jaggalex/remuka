import { PAINT_RANK } from "./stacking.mjs";
import type { InkRole } from "./ink";
import type { WidgetType } from "./types";

/**
 * What a kind of object can do (ADR-049).
 *
 * These answers used to live in five places at once: `canConnect` in the model,
 * `holdsText` in the document, `isEditable` in the app, the paint ranks in a table,
 * and a handful of `type === "…"` checks in the arrange and layer commands. Adding a
 * capability then meant finding every copy — and the copies had already started to
 * disagree. One table, consulted by everybody, is the smallest honest fix: it changes
 * no behaviour, but it turns "add a widget type" from eight files into this file.
 *
 * A capability is added here only when at least two modules need to agree on it.
 */
export interface KindSpec {
  /** Paint layer when the object carries no explicit `z`; higher is on top. */
  rank: number;
  /** Holds text: a note's body, a card's title, a line's label. */
  text: boolean;
  /**
   * Takes headings, lists and checklists (ADR-252 §2.5).
   *
   * A card is a title and a connector label is one line, so both take inline marks only.
   * The painter, the line-format command and the toolbar read this flag instead of
   * listing the types again.
   */
  richBlocks: boolean;
  /** Can be an endpoint of a connector, so it shows anchors. */
  connectable: boolean;
  /** Opens in the inline text editor (double-click, Enter, Tab from a note). */
  editable: boolean;
  /** Takes part in the stacking order. Cards do not: the matrix places them. */
  layered: boolean;
  /** Has a free position, so align/distribute may move it. */
  movable: boolean;
  /** Can be a member of a group (ADR-022). */
  groupable: boolean;
  /** Gets corner handles when it is selected alone. */
  resizable: boolean;
  /**
   * Keeps its proportions while a corner handle is dragged (ADR-249).
   *
   * The flag, not the Shift key: Shift is the generic free-resize override, and a
   * picture that can be squashed is almost always a mistake (`spec/images.md` §3.2).
   * Only a kind whose content has a natural shape sets it.
   */
  aspectLocked?: boolean;
  /**
   * Smallest box a corner handle may leave (ADR-141).
   *
   * Absent means the generic floor below, which is enough for a handle and a word.
   * A frame needs its own floor: below it there is no title band and no room to
   * drop anything inside.
   */
  minSize?: { width: number; height: number };
  /**
   * The surface this kind's ink is derived from, and the roles its parts play
   * (ADR-273 §3.5).
   *
   * `ownFill` is content with a fill of its own (a note, a shape, a card); `container`
   * is a kind whose parts sit on a fill it paints (a frame body, a table); `canvas` is
   * a kind with no surface of its own (a line, a caption). A new kind answers here, and
   * `ink.matrix.test.ts` walks every role of every kind over every palette fill in both
   * themes — a kind that does not declare its ink does not build.
   */
  ink: KindInk;
}

/** Where a kind's parts take their ink from (ADR-273 §2.1). */
export type InkGround = "ownFill" | "container" | "canvas";

export interface KindInk {
  ground: InkGround;
  roles: readonly InkRole[];
}

/** Generic floor for a kind whose box is still meaningful while small. */
export const DEFAULT_MIN_SIZE = { width: 80, height: 60 };

/**
 * The floor a resize of `type` must respect.
 *
 * One function, so the gesture (which clamps the preview), the document command
 * (which clamps what is written) and any future caller cannot disagree.
 */
export function minimumSizeOf(type: WidgetType | string): { width: number; height: number } {
  return kindOf(type).minSize ?? DEFAULT_MIN_SIZE;
}

/**
 * Capabilities per kind.
 *
 * `Record<WidgetType, …>` rather than a lookup with a fallback: a new member of
 * `WidgetType` must be given an answer here or the build fails, which is exactly the
 * reminder we want. The fallback below only serves data from the wire.
 */
export const WIDGET_KINDS: Record<WidgetType, KindSpec> = {
  frame: {
    ink: { ground: "container", roles: ["text", "muted", "line", "lineStrong"] },
    // Frames sit at the back: their contents must never be covered by their plate.
    rank: PAINT_RANK.frame,
    text: false,
    richBlocks: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    // A frame is a layout container, not a fixed picture: the person who made it
    // decides how much of the board it covers (ADR-141).
    resizable: true,
    // Title band 18 px plus 16 px of padding on each side leaves 70 px of usable
    // height at 120; 160 is the narrowest box that still shows the frame's name
    // and lets a note's centre land inside. Below that a frame is a line (ADR-141).
    minSize: { width: 160, height: 120 },
  },
  kanban: {
    ink: { ground: "ownFill", roles: ["text", "muted", "icon", "line", "lineStrong"] },
    rank: PAINT_RANK.kanban,
    text: false,
    richBlocks: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  shape: {
    ink: { ground: "ownFill", roles: ["text", "lineStrong"] },
    rank: PAINT_RANK.shape,
    text: true,
    richBlocks: true,
    connectable: true,
    editable: true,
    layered: true,
    movable: true,
    groupable: true,
    // A shape is a note with another outline: it holds text, has a box and takes
    // the same four corner handles. The preset size is a starting point, not a
    // property of the kind (ADR-145).
    resizable: true,
  },
  image: {
    ink: { ground: "ownFill", roles: ["icon", "muted", "line"] },
    rank: PAINT_RANK.image,
    text: false,
    richBlocks: false,
    connectable: true,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    // A picture has a natural shape: it takes the same corner handles as a note, and
    // the handle never lets the proportion go (ADR-249).
    resizable: true,
    aspectLocked: true,
  },
  unsupported: {
    ink: { ground: "canvas", roles: ["muted", "lineStrong"] },
    rank: PAINT_RANK.unsupported,
    text: false,
    richBlocks: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  connector: {
    ink: { ground: "canvas", roles: ["text", "lineStrong"] },
    // A line sits above the objects it joins; its label is painted on top of it.
    rank: PAINT_RANK.connector,
    text: true,
    richBlocks: false,
    // No anchor on a line: a connector between connectors is not a diagram.
    connectable: false,
    editable: true,
    layered: true,
    // A line has no position of its own — it is derived from its endpoints.
    movable: false,
    groupable: false,
    resizable: false,
  },
  /**
   * A legacy group object from imported boards.
   *
   * This clone models a group as membership (`groupId`), not as a container
   * (ADR-022), so nothing creates these — but an imported board can still contain one,
   * and it must keep behaving like the plain box it was.
   */
  group: {
    ink: { ground: "canvas", roles: ["lineStrong"] },
    rank: PAINT_RANK.group,
    text: false,
    richBlocks: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  timer: {
    ink: { ground: "ownFill", roles: ["text", "muted"] },
    // Above notes and cards: a countdown nobody can see is not a shared timer.
    rank: PAINT_RANK.timer,
    richBlocks: false,
    // The painter draws the countdown itself: the object has no editable text and is
    // configured from its own controls, not by typing into it (ADR-075).
    text: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: true,
  },
  stamp: {
    ink: { ground: "ownFill", roles: ["muted"] },
    rank: PAINT_RANK.stamp,
    text: false,
    richBlocks: false,
    connectable: true,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  sticky_note: {
    ink: { ground: "ownFill", roles: ["text", "muted", "line"] },
    rank: PAINT_RANK.sticky_note,
    text: true,
    richBlocks: true,
    connectable: true,
    editable: true,
    layered: true,
    movable: true,
    groupable: true,
    resizable: true,
  },
  card: {
    ink: { ground: "ownFill", roles: ["text", "muted"] },
    rank: PAINT_RANK.card,
    richBlocks: false,
    // A card's text is its title, typed in place.
    text: true,
    // A card can be an endpoint; geometry resolves its box through the kanban
    // placement (ADR-113).
    connectable: true,
    editable: true,
    // A card's layer is its cell, not a z index.
    layered: false,
    movable: false,
    groupable: false,
    resizable: false,
  },
  text: {
    ink: { ground: "canvas", roles: ["text"] },
    // Text blocks sit above everything: a caption is never covered.
    rank: PAINT_RANK.text,
    text: true,
    richBlocks: true,
    connectable: true,
    editable: true,
    layered: true,
    movable: true,
    groupable: true,
    resizable: true,
  },
};

/**
 * Conservative answer for a type this build does not know.
 *
 * An unknown widget is shown and can be moved and selected, but it accepts no text,
 * no connectors and no editing: guessing "yes" would offer actions that fail.
 */
const UNKNOWN_KIND: KindSpec = {
  rank: 5,
  // An unknown kind is a plain box on the canvas: it declares the weakest ink there is.
  ink: { ground: "canvas", roles: ["muted", "lineStrong"] },
  text: false,
  richBlocks: false,
  connectable: false,
  editable: false,
  layered: true,
  movable: true,
  groupable: true,
  resizable: false,
};

export function kindOf(type: WidgetType | string): KindSpec {
  return (WIDGET_KINDS as Record<string, KindSpec | undefined>)[type] ?? UNKNOWN_KIND;
}
