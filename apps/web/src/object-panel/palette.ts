import { colorAt, type ToneColor } from "@remo/model";
import type { TranslationKey } from "../i18n";
import { colorWord } from "./colorWindowData";

export interface NoteFillChoice extends ToneColor {
  key: TranslationKey;
}

const quickTones = ["yellow", "green", "blue", "pink", "violet", "orange", "grey"] as const;

/** Quick fills in rail order. Object properties offer both rows and named fills (ADR-299). */
export function noteFillChoices(): NoteFillChoice[] {
  return quickTones.map((tone) => {
    const color = colorAt(tone, 100);
    return { ...color, key: colorWord(color.hex) };
  });
}

export function defaultStickerFill(): string {
  return colorAt("yellow", 100).hex;
}
