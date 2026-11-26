import { useEffect } from "react";
import { countHint } from "./hintCatalog";
import { useI18n } from "./i18n";
import type { HintTextKey } from "./hintSlots";

/** A fixed teaching place whose only variant changes words between visits. */
export function HintCopy({ slot, text }: { slot: string; text: HintTextKey }) {
  const { t } = useI18n();
  useEffect(() => { countHint("hint.shown", slot, "action"); }, [slot]);
  return t(text);
}
