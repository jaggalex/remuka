import { useCallback, useEffect, useRef, useState } from "react";
import type { ShapeKind } from "@remo/model";
import { markHintDone } from "./hints";

export type ArmedToolName = "shape" | "sticky" | "text";
type Mode = "single" | "held" | "last" | "locked";

export interface ArmedTool {
  tool: ArmedToolName;
  variant: string;
  mode: Mode;
  code?: string;
}

/** The rail, keyboard and gestures share one armed tool (ADR-268, ADR-271). */
export function useArmedTool(onTap: (tool: "sticky" | "text") => void, blocked: boolean) {
  const [armed, setArmed] = useState<ArmedTool | null>(null);
  const placements = useRef(0);
  const arm = (tool: ArmedToolName, variant: string, mode: Mode, code?: string) => {
    placements.current = 0;
    setArmed({ tool, variant, mode, code });
  };
  const disarm = useCallback(() => setArmed(null), []);
  const finish = () => {
    placements.current++;
    if (armed?.tool === "sticky" && placements.current === 2) markHintDone("sticky.series");
    if (armed?.mode !== "held" && armed?.mode !== "locked") disarm();
  };

  useEffect(() => {
    if (!armed) return;
    if (blocked) { disarm(); return; }
    const keyUp = (event: KeyboardEvent) => {
      if (armed.mode !== "held" || event.code !== armed.code) return;
      if (placements.current > 0) setArmed({ ...armed, mode: "last" });
      else if (armed.tool === "shape") setArmed({ ...armed, mode: "single" });
      else { disarm(); onTap(armed.tool); }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.repeat && armed.mode === "held" && event.code === armed.code) {
        event.preventDefault();
        event.stopPropagation();
      }
      // A placed note has the caret. Its editor still handles Escape to finish the text.
      if (event.key === "Escape" && event.target instanceof Element && event.target.closest(".inline-editor")) disarm();
    };
    // The release can arrive over an editor or another window.
    const blur = () => { if (armed.mode === "held") disarm(); };
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("blur", blur);
    };
  }, [armed, blocked, disarm, onTap]);

  return { armed, arm, disarm, finish };
}

export function armedShapeKind(armed: ArmedTool | null): ShapeKind | null {
  return armed?.tool === "shape" ? (armed.variant as ShapeKind) : null;
}
