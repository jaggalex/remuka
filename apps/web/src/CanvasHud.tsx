import { Button, ZoomControls } from "@remo/ui";
import type { Camera } from "@remo/canvas";
import { openCommandSearch } from "./commandSearchStore";
import { useI18n } from "./i18n";
import { useChromeQuiet } from "./quietChrome";

/**
 * World coordinates are a developer's instrument, not a product readout (§10.4, Н2):
 * they live behind `?debug` instead of on the screen.
 */
const DEBUG = new URLSearchParams(window.location.search).has("debug");

/**
 * The bottom-left view controls: the search row and the design system's zoom panel
 * (ADR-232, ADR-266 §1.2). This component only places them and, behind `?debug`, the
 * world cursor.
 */
export function CanvasHud({
  camera,
  worldCursor,
  onFit,
  onZoom,
}: {
  camera: Camera;
  worldCursor: { x: number; y: number } | null;
  onFit: () => void;
  onZoom: (factor: number) => void;
}) {
  const { t } = useI18n();
  const quiet = useChromeQuiet();
  return (
    <div className={quiet ? "canvas-hud is-quiet" : "canvas-hud"}>
      <Button
        variant="secondary"
        size="default"
        icon="search"
        className="canvas-search"
        onClick={() => openCommandSearch()}
      >
        {t("search.action")}
        <span className="canvas-search-key" aria-hidden="true">
          ⌘K
        </span>
      </Button>
      <ZoomControls
        zoom={Math.round(camera.zoom * 100)}
        onOut={() => onZoom(1 / 1.2)}
        onIn={() => onZoom(1.2)}
        onFit={onFit}
        fitHint={t("canvas.fitHint")}
      />
      {DEBUG && worldCursor && (
        <span className="hud-cursor" aria-hidden="true">
          {Math.round(worldCursor.x)}, {Math.round(worldCursor.y)}
        </span>
      )}
    </div>
  );
}
