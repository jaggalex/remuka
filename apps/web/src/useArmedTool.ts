import { useCallback, useState } from "react";
import type { ShapeKind } from "@remo/model";

/**
 * A creation tool that waits for a gesture (ADR-271).
 *
 * Choosing a shape tool no longer creates at once: it *arms* the tool, and the next
 * press on the canvas either draws the object at size or, as a click, creates the
 * default (ADR-119). One state serves the rail, the keys and the canvas, so the three
 * cannot disagree about what is armed.
 *
 * `series` is the double-click lock: the tool stays armed after every creation until
 * Escape. T12 reuses the same state for the sticky-note series (ADR-268) instead of
 * growing a second "active tool" flag.
 */
export type ArmedToolName = "shape" | "sticky" | "text";

export interface ArmedTool {
  tool: ArmedToolName;
  /** The variety chosen in the flyout: a shape kind now, a note fill for T12. */
  variant: string;
  /** A double-click locked the tool until Escape. */
  series: boolean;
}

export function useArmedTool() {
  const [armed, setArmed] = useState<ArmedTool | null>(null);

  const arm = useCallback((tool: ArmedToolName, variant: string, series = false) => {
    setArmed({ tool, variant, series });
  }, []);

  const disarm = useCallback(() => setArmed(null), []);

  /**
   * A creation finished. A series stays armed; a single tool goes back to Select.
   * Kept here rather than in the gesture so the rail and the canvas agree.
   */
  const finish = useCallback(() => {
    setArmed((current) => (current && !current.series ? null : current));
  }, []);

  return { armed, arm, disarm, finish };
}

/** The shape kind an armed state carries, when it is the shape tool. */
export function armedShapeKind(armed: ArmedTool | null): ShapeKind | null {
  return armed?.tool === "shape" ? (armed.variant as ShapeKind) : null;
}
