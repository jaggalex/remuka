import type { ShapeKind } from "@remo/model";
import { Button } from "@remo/ui";
import { useI18n, type TranslationKey } from "../i18n";

/**
 * The five shape kinds as the person meets them: a silhouette, its name and, for the
 * two the keyboard knows, its key (ADR-271).
 *
 * One list is used by the rail's flyout, the object bar and the multi-selection bar, so
 * a new kind or a renamed one appears in all three without a second table.
 */
export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "round_rectangle",
  "ellipse",
  "diamond",
  "triangle",
];

export const SHAPE_KIND_LABEL: Record<ShapeKind, TranslationKey> = {
  rectangle: "tool.shapeRectangle",
  round_rectangle: "tool.shapeRoundRectangle",
  ellipse: "tool.shapeEllipse",
  diamond: "tool.shapeDiamond",
  triangle: "tool.shapeTriangle",
};

/** Only two kinds have a key; the rest are chosen in a menu (ADR-119). */
const SHAPE_KIND_KEY: Partial<Record<ShapeKind, string>> = {
  rectangle: "R",
  ellipse: "O",
};

/** The drawn silhouette at 22×18, in the bar's own ink. */
export function ShapeSilhouette({ kind }: { kind: ShapeKind }) {
  const body = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true" focusable="false">
      {kind === "rectangle" && <rect x="1" y="2" width="20" height="14" rx="2" {...body} />}
      {kind === "round_rectangle" && <rect x="1" y="2" width="20" height="14" rx="5" {...body} />}
      {kind === "ellipse" && <ellipse cx="11" cy="9" rx="10" ry="7" {...body} />}
      {kind === "diamond" && <polygon points="11,1 21,9 11,17 1,9" {...body} />}
      {kind === "triangle" && <polygon points="11,1 21,17 1,17" {...body} />}
    </svg>
  );
}

function kindTitle(kind: ShapeKind, t: (key: TranslationKey) => string): string {
  const key = SHAPE_KIND_KEY[kind];
  return key ? `${t(SHAPE_KIND_LABEL[kind])} · ${key}` : t(SHAPE_KIND_LABEL[kind]);
}

/**
 * A row of silhouettes for a popover: each is a real button with its name, its key in
 * the tooltip and a pressed state.
 */
export function ShapeKindGrid({
  value,
  onPick,
  ariaLabel,
}: {
  /** null when the selection mixes kinds: nothing is pressed until a choice is made. */
  value: ShapeKind | null;
  onPick: (kind: ShapeKind) => void;
  ariaLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="shape-kind-grid" role="group" aria-label={ariaLabel}>
      {SHAPE_KINDS.map((kind) => (
        <Button
          key={kind}
          variant="ghost"
          size="compact"
          className="shape-kind-button"
          aria-label={t(SHAPE_KIND_LABEL[kind])}
          title={kindTitle(kind, t)}
          selected={kind === value}
          onClick={() => onPick(kind)}
        >
          <ShapeSilhouette kind={kind} />
        </Button>
      ))}
    </div>
  );
}

/** The rail's flyout: a vertical list where the name and the key are visible. */
export function ShapeKindList({
  value,
  onPick,
  ariaLabel,
}: {
  value: ShapeKind | null;
  onPick: (kind: ShapeKind) => void;
  ariaLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="shape-kind-list" role="group" aria-label={ariaLabel}>
      {SHAPE_KINDS.map((kind) => (
        <Button
          key={kind}
          variant="ghost"
          size="compact"
          className="shape-kind-row"
          aria-label={t(SHAPE_KIND_LABEL[kind])}
          selected={kind === value}
          onClick={() => onPick(kind)}
        >
          <span className="shape-kind-row-icon">
            <ShapeSilhouette kind={kind} />
          </span>
          <span className="shape-kind-row-name">{t(SHAPE_KIND_LABEL[kind])}</span>
          {SHAPE_KIND_KEY[kind] && (
            <kbd className="shape-kind-row-key">{SHAPE_KIND_KEY[kind]}</kbd>
          )}
        </Button>
      ))}
    </div>
  );
}

/**
 * "Sharp / Rounded": the two corner kinds, not a new field (ADR-271).
 *
 * A kind that has no corners to round shows the switch disabled and says why, so the
 * control is not hidden and then missed; `aria-label` carries the reason to a reader.
 */
export function ShapeCorners({
  rounded,
  disabled,
  onChange,
}: {
  /** true — every selected shape is rounded, false — sharp, null — the selection mixes them. */
  rounded: boolean | null;
  /** Why the switch does not apply; its words also reach a screen reader. */
  disabled: boolean;
  onChange: (rounded: boolean) => void;
}) {
  const { t } = useI18n();
  const reason = t("shape.cornersRectangleOnly");
  const label = (text: string) => (disabled ? `${text}. ${reason}` : text);
  return (
    <div
      className="shape-corners"
      role="group"
      aria-label={disabled ? `${t("shape.corners")}. ${reason}` : t("shape.corners")}
    >
      <Button
        variant="ghost"
        size="compact"
        aria-label={label(t("shape.sharp"))}
        title={label(t("shape.sharp"))}
        selected={rounded === false}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        {t("shape.sharp")}
      </Button>
      <Button
        variant="ghost"
        size="compact"
        aria-label={label(t("shape.rounded"))}
        title={label(t("shape.rounded"))}
        selected={rounded === true}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        {t("shape.rounded")}
      </Button>
    </div>
  );
}

/** Whether a kind has corners the switch can round. */
export function hasRoundCorners(kind: ShapeKind): boolean {
  return kind === "rectangle" || kind === "round_rectangle";
}

/**
 * What a set of selected shapes says about its kind and its corners.
 *
 * One answer for the single-object bar and the multi-selection bar: a mixed kind shows
 * no pressed silhouette, and the corner switch is available only when every selected
 * shape is a rectangle of one of the two kinds.
 */
export function shapeSelection(kinds: readonly ShapeKind[]): {
  kind: ShapeKind | null;
  rounded: boolean | null;
  canRound: boolean;
} {
  const unique = new Set(kinds);
  const kind = unique.size === 1 ? kinds[0]! : null;
  const canRound = kinds.length > 0 && kinds.every(hasRoundCorners);
  const rounded = canRound
    ? kinds.every((entry) => entry === "round_rectangle")
      ? true
      : kinds.every((entry) => entry === "rectangle")
        ? false
        : null
    : null;
  return { kind, rounded, canRound };
}
