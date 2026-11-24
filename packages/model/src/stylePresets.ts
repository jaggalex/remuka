import { TONE_LEVELS } from "./colorLevels";
import { SHAPE_INK, SHAPE_PAPER } from "./shapeFill";
import type { WidgetStyle } from "./types";

/**
 * Built-in style presets (ADR-120, values on the tonal palette since ADR-129).
 *
 * A preset is a named bundle of fields the model already has: no new style field, no
 * migration. Every colour comes from `colorLevels.ts`, so a preset paints exactly the
 * value its swatch draws — a built-in look must never open the window on "Custom colour".
 * Text is always automatic (`textColor` is never set), so a preset cannot break
 * readability (ADR-038). Names live in i18n as `preset.shape.<id>` / `preset.line.<id>`;
 * the model carries data, never words.
 */
export interface ShapePreset {
  id: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

const GREY = TONE_LEVELS.grey;
const YELLOW = TONE_LEVELS.yellow;
const ORANGE = TONE_LEVELS.orange;
const BLUE = TONE_LEVELS.blue;
const GREEN = TONE_LEVELS.green;

export const SHAPE_PRESETS = [
  { id: "plain", fill: SHAPE_PAPER, stroke: SHAPE_INK, strokeWidth: 2 },
  { id: "outline", fill: "transparent", stroke: GREY[600], strokeWidth: 2 },
  { id: "sunny", fill: YELLOW[300], stroke: "transparent", strokeWidth: 0 },
  { id: "warm", fill: ORANGE[100], stroke: ORANGE[600], strokeWidth: 2 },
  { id: "cool", fill: BLUE[100], stroke: BLUE[600], strokeWidth: 2 },
  { id: "accent", fill: GREEN[300], stroke: "transparent", strokeWidth: 0 },
] as const satisfies readonly ShapePreset[];

/** The shape a new object starts with, so its sample rings a swatch (ADR-129). */
export const DEFAULT_SHAPE_PRESET: ShapePreset = SHAPE_PRESETS[0];

export function shapePresetStyle(preset: ShapePreset): WidgetStyle {
  return {
    fillColor: preset.fill,
    strokeColor: preset.stroke,
    strokeWidth: preset.strokeWidth,
  };
}

export interface LinePreset {
  id: string;
  /**
   * The line's colour, or null for Auto (ADR-273 §2.3): a new line stores no colour and
   * takes the ink of the canvas ground, so it reads in both themes.
   */
  color: string | null;
  width: number;
  dash: "normal" | "dashed" | "dotted";
  arrow: "none" | "end" | "start" | "both";
}

export const LINE_PRESETS = [
  { id: "plain", color: null, width: 2, dash: "normal", arrow: "end" },
  { id: "dashed", color: GREY[300], width: 1, dash: "dashed", arrow: "end" },
  { id: "accent", color: GREEN[600], width: 4, dash: "normal", arrow: "end" },
  { id: "warning", color: ORANGE[600], width: 2, dash: "normal", arrow: "end" },
  { id: "dependency", color: BLUE[600], width: 2, dash: "dotted", arrow: "end" },
] as const satisfies readonly LinePreset[];

/** The line a new connector starts with (ADR-129). */
export const DEFAULT_LINE_PRESET: LinePreset = LINE_PRESETS[0];

/** The stroke half of a line preset; the arrow head is a widget field, applied beside it. */
export function linePresetStyle(preset: LinePreset): WidgetStyle {
  return {
    ...(preset.color ? { strokeColor: preset.color } : {}),
    strokeWidth: preset.width,
    strokeStyle: preset.dash,
  };
}
