import type { Elevation, LineFormat, ShapeKind, ShapePreset, StickySize, TextLine, TextMarks } from "@remo/model";

/** One line format of the object, ready for the bar (ADR-252 §2.2). */
export type TextLineBlock = NonNullable<LineFormat["block"]>;

/**
 * What the object bar shows and what it can do, without the bar itself.
 *
 * The panels for a note, a shape and the shared "customize" popover read these types;
 * keeping them out of `StickyPanel.tsx` lets those files import the contract without
 * importing each other (ADR-124).
 */
export interface StickyBarTarget {
  id: string;
  /** Notes, shapes and free text share this bar; the sample and some controls differ. */
  kind: "note" | "shape" | "text";
  /** Screen-space box of the note. */
  rect: { left: number; top: number; width: number; height: number };
  /** Where the bar itself goes, already clamped to the canvas. */
  placement: { left: number; top: number };
  fillColor?: string;
  /** Explicit text colour; absent means it follows the fill. */
  textColor?: string;
  /** The colour the text actually has right now, explicit or automatic. */
  ink: string;
  /** The surface the text lies on, for the colour window's readability warning (ADR-273). */
  ground: string;
  /** Shape outline; unused by notes. */
  strokeColor?: string;
  strokeWidth?: number;
  /** Shape outline dash; unused by notes. */
  strokeStyle?: "normal" | "dashed" | "dotted";
  /** A shape's kind; absent for notes and text. */
  shapeKind?: ShapeKind;
  /** The shape's lift level, and whether it can stand off the board (ADR-245). */
  elevation: Elevation | null;
  canElevate: boolean;
  size: StickySize;
  /** Explicit text size, or null for Auto. */
  fontSize: number | null;
  /** Size Auto is currently using, shown next to the word "Auto". */
  autoSize: number;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  marks: TextMarks | null;
  /**
   * The object's lines, materialized only when its text has at least one block
   * (ADR-252 §2.3). The bar reads the shared block of all lines from here; absent means
   * plain text, where no block can be pressed.
   */
  lines?: TextLine[];
  /** The kind takes headings, lists and checklists (ADR-252 §2.5). */
  richBlocks: boolean;
  /** Read-only note (a card) gets no property controls. */
  editable: boolean;
}

export interface StickyBarActions {
  setColor: (name: string) => void;
  /** `null` restores the automatic colour that follows the fill. */
  setInk: (color: string | null) => void;
  /** `null` restores the automatic outline that follows the shape's ground. */
  setStroke: (color: string | null) => void;
  setStrokeWidth: (width: number) => void;
  setStrokeStyle: (style: "normal" | "dashed") => void;
  /** Switch a shape's kind, keeping its text, size, style and connectors (ADR-271). */
  setShapeKind: (kind: ShapeKind) => void;
  /** The shape's lift level (ADR-245, ADR-267); the bar carries it as the mockup does. */
  setElevation: (level: Elevation | null) => void;
  setSize: (size: StickySize) => void;
  setFont: (size: number | null) => void;
  toggleMark: (mark: keyof TextMarks) => void;
  /**
   * Set one line format on every line of the object — a heading, a list or a checklist;
   * pressing the format the object already has removes it. One command, one undo step.
   */
  setLineBlock: (block: TextLineBlock) => void;
  /** Move every list line one level deeper (1) or shallower (-1); other lines stay. */
  setLineIndent: (direction: 1 | -1) => void;
  /** Remove every mark and every line format from the object's text. */
  clearFormatting: () => void;
  setAlign: (align: "left" | "center" | "right") => void;
  setVAlign: (vAlign: "top" | "middle" | "bottom") => void;
  /**
   * One chip, one preset, one undo step: the document writes fill, outline and width
   * together, so undo does not have to be pressed three times (ADR-120).
   */
  applyShapePreset: (preset: ShapePreset) => void;
  /** Delete from "More" — the same path as the Delete key, confirmation included. */
  remove: () => void;
}
