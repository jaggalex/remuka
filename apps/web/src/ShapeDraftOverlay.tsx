import type { Camera } from "@remo/canvas";
import type { Rect, ShapeKind } from "@remo/model";
import { useI18n } from "./i18n";

/**
 * The outline a person is drawing and its size (ADR-271).
 *
 * It is chrome, not content: nothing is in the document until the release, so this is
 * a DOM layer over the canvas like the selection box. The shape is the real silhouette
 * of the chosen kind, dashed, so a triangle is drawn as a triangle before it exists.
 */
export function ShapeDraftOverlay({
  draft,
  camera,
  viewport,
}: {
  draft: { rect: Rect; kind: ShapeKind } | null;
  camera: Camera;
  viewport: { width: number; height: number };
}) {
  const { t } = useI18n();
  if (!draft) return null;

  const { rect, kind } = draft;
  const left = viewport.width / 2 + (rect.x - camera.x) * camera.zoom;
  const top = viewport.height / 2 + (rect.y - camera.y) * camera.zoom;
  const width = Math.max(1, rect.width * camera.zoom);
  const height = Math.max(1, rect.height * camera.zoom);
  const size = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

  return (
    <div
      className="shape-draft"
      style={{ left, top, width, height }}
      aria-label={t("canvas.shapeSize", { size })}
    >
      <svg
        className="shape-draft-outline"
        width={width}
        height={height}
        viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
        aria-hidden="true"
      >
        {kind === "ellipse" ? (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={width / 2 - 1}
            ry={height / 2 - 1}
            vectorEffect="non-scaling-stroke"
          />
        ) : kind === "diamond" ? (
          <polygon
            points={`${width / 2},1 ${width - 1},${height / 2} ${width / 2},${height - 1} 1,${height / 2}`}
            vectorEffect="non-scaling-stroke"
          />
        ) : kind === "triangle" ? (
          <polygon
            points={`${width / 2},1 ${width - 1},${height - 1} 1,${height - 1}`}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <rect
            x="1"
            y="1"
            width={width - 2}
            height={height - 2}
            rx={kind === "round_rectangle" ? Math.min(height, width) * 0.3 : 6}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="shape-draft-size">{size}</span>
    </div>
  );
}
