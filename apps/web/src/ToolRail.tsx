import { useEffect, useRef, type Ref } from "react";
import type { ConnectorRouting, ShapeKind } from "@remo/model";
import { Button, Icon, IconButton, Popover, Separator, Tooltip } from "@remo/ui";
import type { IconName } from "@remo/ui";
import { useI18n, type TranslationKey } from "./i18n";
import { useChromeQuiet } from "./quietChrome";
import type { NoteFillChoice } from "./object-panel/palette";
import { ShapeKindList } from "./object-panel/ShapeKindPicker";

/** A rail tool. Select is not a creation tool; it only drops the selection. */
export type RailTool =
  | "select"
  | "sticky"
  | "text"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "image"
  | "connector"
  | "frame"
  | "card"
  | "comment"
  | "sticky-stack";

/** The flyout a tool (or "More") opens, one at a time. */
export type RailFlyout = "sticky" | "shape" | "connector" | "more" | null;

/** One row of «Ещё», already resolved from the command registry by the caller. */
export interface RailMoreItem {
  id: string;
  label: string;
  icon: IconName;
  disabled?: boolean;
  reason?: string;
  onSelect: () => void;
}

const ROUTINGS: ReadonlyArray<{ value: ConnectorRouting; key: TranslationKey; icon: IconName }> = [
  { value: "curved", key: "line.curved", icon: "connector-curved" },
  { value: "straight", key: "line.straight", icon: "connector-straight" },
  { value: "elbow", key: "line.elbowed", icon: "connector-elbow" },
];

/**
 * The one place objects are created (ADR-119, ADR-266 §10a).
 *
 * Seven tools — select, note, shape, text, connector, frame, picture — and «More» for
 * the rest. A tool with variants opens its samples on the tool itself: the marker in
 * the corner, or a click on the tool while it is the active one. The choice is
 * remembered for the next object by `toolDefaults`; this file only shows it.
 *
 * History is in the same paper panel under the hairline, not a second pill: the rail is
 * one control surface, as the mockup draws it (ADR-286).
 */
export function ToolRail({
  writeBlocked,
  blockedHint,
  canComment,
  flyout,
  onFlyout,
  onSelect,
  onSticky,
  onText,
  onShape,
  onImage,
  onConnector,
  onFrame,
  onCard,
  onComment,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canConnect,
  canAddCard,
  noteColors,
  noteFill,
  armedShape, activeTool, lockedTool, onPointSeries,
  defaultShape,
  onShapeSeries,
  connectorRouting,
  onRouting,
  more,
}: {
  writeBlocked: boolean;
  /** Why creation is off (view-only or the offline queue): the tooltip says it. */
  blockedHint: string;
  canComment: boolean;
  flyout: RailFlyout;
  onFlyout: (next: RailFlyout) => void;
  onSelect: () => void;
  onSticky: (fill?: string) => void;
  onText: () => void;
  onShape: (kind: ShapeKind) => void;
  /** Open the system file picker: pictures become objects after they are uploaded. */
  onImage: () => void;
  onConnector: () => void;
  onFrame: () => void;
  onCard: () => void;
  onComment: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canConnect: boolean;
  canAddCard: boolean;
  noteColors: readonly NoteFillChoice[];
  /** The fill the next note takes; it is what the flyout rings (ADR-266 §10a). */
  noteFill: string;
  /** The shape waiting for a drag on the canvas (ADR-271). */
  armedShape: ShapeKind | null;
  activeTool: "sticky" | "shape" | "text" | null;
  lockedTool: "sticky" | "shape" | "text" | null;
  onPointSeries: (tool: "sticky" | "text") => void;
  /** The kind a click arms: the last one chosen in this browser (ADR-266 §10a). */
  defaultShape: ShapeKind;
  /** A double-click on the tool keeps it armed for a series until Escape. */
  onShapeSeries: (kind: ShapeKind) => void;
  /** The line type the next connector takes, and the one the flyout rings. */
  connectorRouting: ConnectorRouting;
  onRouting: (routing: ConnectorRouting) => void;
  /** «More»: the same commands the search finds (T7, T8). */
  more: readonly RailMoreItem[];
}) {
  const { t } = useI18n();
  const quiet = useChromeQuiet();
  const rail = useRef<HTMLDivElement | null>(null);
  const stickyDisclosure = useRef<HTMLButtonElement | null>(null);
  const pendingClick = useRef<number | undefined>(undefined);
  const cancelClick = () => {
    window.clearTimeout(pendingClick.current);
    pendingClick.current = undefined;
  };
  useEffect(() => cancelClick, []);

  useEffect(() => {
    if (!flyout) return;
    const onDown = (event: PointerEvent) => {
      const boundary = flyout === "sticky" ? stickyDisclosure.current?.parentElement : rail.current;
      if (!boundary?.contains(event.target as Node)) onFlyout(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (flyout === "sticky") {
        event.preventDefault();
        event.stopPropagation();
        stickyDisclosure.current?.focus({ preventScroll: true });
      }
      onFlyout(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, flyout === "sticky");
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, flyout === "sticky");
    };
  }, [flyout, onFlyout]);

  /**
   * One tool button, one tooltip.
   *
   * Connectivity and card placement depend on the selection, but a tool that can still
   * explain itself is not disabled (§10.2, Р1): it keeps the primary colour and answers
   * with a sentence. Only a real stop — view-only access, the offline queue — disables
   * the rail, and then the tooltip names the reason.
   */
  const tool = (options: {
    icon: IconName;
    label: TranslationKey;
    shortcut?: string;
    hint?: string;
    /** Why the tool is off when it is off for its own reason, not the board's. */
    reason?: string;
    disabled?: boolean;
    expanded?: boolean;
    locked?: boolean;
    onDoubleClick?: () => void;
    onClick: () => void;
  }) => {
    const disabled = Boolean(options.disabled);
    return (
      <Tooltip
        side="right"
        label={
          disabled
            ? (options.reason ?? blockedHint)
            : options.hint
              ? `${t(options.label)} · ${options.hint}`
              : t(options.label)
        }
        shortcut={disabled || !options.shortcut ? undefined : [options.shortcut]}
      >
        <IconButton
          icon={options.icon}
          label={t(options.label)}
          iconSize={20}
          variant="ghost"
          className="tool-rail-button"
          disabled={disabled}
          selected={options.expanded}
          aria-description={options.locked ? t("tool.seriesLocked") : undefined}
          onMouseDown={event => {
            // Keep an active text edit intact while distinguishing placement from tool lock.
            if (options.onDoubleClick && document.activeElement?.closest(".inline-editor")) {
              event.preventDefault();
            }
          }}
          onClick={event => {
            cancelClick();
            if (!options.onDoubleClick || event.detail === 0) {
              options.onClick();
            } else if (event.detail === 1) {
              pendingClick.current = window.setTimeout(() => {
                pendingClick.current = undefined;
                const editor = document.activeElement;
                if (editor instanceof HTMLElement && editor.closest(".inline-editor")) editor.blur();
                options.onClick();
              }, 400);
            }
          }}
          onDoubleClick={options.onDoubleClick}
        />
      </Tooltip>
    );
  };

  const pickShape = (kind: ShapeKind) => {
    onShape(kind);
    onFlyout(null);
  };

  return (
    <div
      className={quiet ? "tool-rail is-quiet" : "tool-rail"}
      role="toolbar"
      aria-label={t("tool.rail")}
      ref={rail}
    >
      <div className="tool-rail-panel">
        {tool({
          icon: "cursor",
          label: "tool.select",
          shortcut: "V",
          expanded: activeTool === null && flyout === null,
          onClick: onSelect,
        })}

        <div className="tool-rail-item tool-rail-sticky">
          {tool({
            icon: "sticky",
            label: "tool.sticky",
            shortcut: "N",
            disabled: writeBlocked,
            expanded: activeTool === "sticky" || flyout === "sticky",
            locked: lockedTool === "sticky",
            onDoubleClick: () => onPointSeries("sticky"),
            onClick: () => {
              // The active tool explains its variants; a tool that is off acts at once.
              if (flyout === "sticky") onFlyout(null);
              else onSticky(noteFill);
            },
          })}
          {lockedTool === "sticky" && <SeriesLock />}
          <ToolDisclosure
            triggerRef={stickyDisclosure}
            label={t("tool.stickyColors")}
            open={flyout === "sticky"}
            disabled={writeBlocked}
            onClick={() => onFlyout(flyout === "sticky" ? null : "sticky")}
          />
          {flyout === "sticky" && (
            <Popover title={t("tool.stickyPaletteTitle")} side="right">
              <div className="tool-flyout-swatches" role="group" aria-label={t("tool.stickyColors")}>
                {noteColors.map((color) => (
                  <Tooltip key={color.tone} label={t(color.key)}>
                    <Button
                      variant="ghost"
                      className="tool-swatch"
                      data-hex={color.hex}
                      aria-label={t(color.key)}
                      selected={color.hex === noteFill}
                      onClick={() => {
                        onSticky(color.hex);
                        onFlyout(null);
                      }}
                    >
                      <span className="tool-swatch-paper" style={{ backgroundColor: color.hex }} />
                    </Button>
                  </Tooltip>
                ))}
              </div>
              <p className="tool-flyout-note">
                {t("tool.seriesHint")} {t("tool.seriesLockHint")}
              </p>
            </Popover>
          )}
        </div>

        <div className="tool-rail-item">
          {tool({
            icon: "shape",
            label: "tool.shape",
            shortcut: "R",
            disabled: writeBlocked,
            expanded: armedShape !== null || flyout === "shape",
            locked: lockedTool === "shape",
            onClick: () => {
              // An armed tool explains its five silhouettes; a fresh one arms.
              if (armedShape !== null) onFlyout(flyout === "shape" ? null : "shape");
              else onShape(defaultShape);
            },
            onDoubleClick: () => onShapeSeries(armedShape ?? defaultShape),
          })}
          {lockedTool === "shape" && <SeriesLock />}
          <ToolDisclosure
            label={t("tool.shapeVariants")}
            open={flyout === "shape"}
            disabled={writeBlocked}
            onClick={() => onFlyout(flyout === "shape" ? null : "shape")}
          />
          {flyout === "shape" && (
            <Popover
              title={t("tool.shapeVariants")}
              width={252}
              side="right"
              onClose={() => onFlyout(null)}
            >
              <ShapeKindList
                value={armedShape}
                ariaLabel={t("tool.shapeVariants")}
                onPick={pickShape}
              />
            </Popover>
          )}
        </div>

        <div className="tool-rail-item">
          {tool({
          icon: "text",
          label: "tool.text",
          shortcut: "T",
          disabled: writeBlocked,
          expanded: activeTool === "text",
          locked: lockedTool === "text",
          onDoubleClick: () => onPointSeries("text"),
          onClick: onText,
          })}
          {lockedTool === "text" && <SeriesLock />}
        </div>

        <div className="tool-rail-item">
          {tool({
            icon: "connector",
            label: "tool.connector",
            shortcut: "L",
            hint: canConnect ? undefined : t("tool.connectorHint"),
            disabled: writeBlocked,
            expanded: flyout === "connector",
            onClick: () => {
              if (flyout === "connector") onFlyout(null);
              else onConnector();
            },
          })}
          <ToolDisclosure
            label={t("tool.connectorVariants")}
            open={flyout === "connector"}
            disabled={writeBlocked}
            onClick={() => onFlyout(flyout === "connector" ? null : "connector")}
          />
          {flyout === "connector" && (
            <Popover
              title={t("tool.connectorVariants")}
              width={196}
              side="right"
              onClose={() => onFlyout(null)}
            >
              <div
                className="tool-flyout-connector"
                role="group"
                aria-label={t("tool.connectorVariants")}
              >
                {ROUTINGS.map((entry) => (
                  <Tooltip key={entry.value} label={t(entry.key)} side="bottom">
                    <IconButton
                      icon={entry.icon}
                      label={t(entry.key)}
                      iconSize={20}
                      selected={connectorRouting === entry.value}
                      onClick={() => {
                        onRouting(entry.value);
                        onFlyout(null);
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
              <p className="tool-flyout-note">{t("tool.connectorNote")}</p>
            </Popover>
          )}
        </div>

        {tool({
          icon: "frame",
          label: "tool.frame",
          shortcut: "F",
          disabled: writeBlocked,
          onClick: onFrame,
        })}

        {tool({
          icon: "image",
          label: "tool.image",
          shortcut: "I",
          hint: t("tool.imageHint"),
          disabled: writeBlocked,
          onClick: onImage,
        })}

        <div className="tool-rail-item">
          {tool({
            icon: "more",
            label: "tool.more",
            disabled: writeBlocked,
            expanded: flyout === "more",
            onClick: () => onFlyout(flyout === "more" ? null : "more"),
          })}
          {flyout === "more" && (
            <Popover
              title={t("tool.more")}
              width={240}
              side="right"
              onClose={() => onFlyout(null)}
            >
              <div className="tool-more-list" role="menu" aria-label={t("tool.more")}>
                {more.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="tool-more-item"
                    data-command={item.id}
                    disabled={item.disabled}
                    title={item.disabled ? item.reason : undefined}
                    onClick={() => {
                      onFlyout(null);
                      item.onSelect();
                    }}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        <Separator />

        <Tooltip side="right" label={t("board.undo")}>
          <IconButton
            icon="undo"
            label={t("board.undo")}
            iconSize={18}
            className="tool-rail-button tool-history-button"
            disabled={!canUndo}
            onClick={onUndo}
          />
        </Tooltip>
        <Tooltip side="right" label={t("board.redo")}>
          <IconButton
            icon="redo"
            label={t("board.redo")}
            iconSize={18}
            className="tool-rail-button tool-history-button"
            disabled={!canRedo}
            onClick={onRedo}
          />
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The corner marker of a tool with variants.
 *
 * A 6 px wedge in the bottom-right of the 44 px button, the way the mockup draws it: it
 * marks "more here" and keeps its hit area off the glyph, so the icon is never covered
 * and a click on the icon still creates (Р2).
 */
function ToolDisclosure({
  triggerRef,
  label,
  open,
  disabled,
  onClick,
}: {
  triggerRef?: Ref<HTMLButtonElement>;
  label: string;
  open: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      className={`tool-rail-caret${open ? " open" : ""}`}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      onMouseDown={event => {
        // Browsing variants leaves the inline editor and its text selection in place.
        if (document.activeElement?.closest(".inline-editor")) event.preventDefault();
      }}
      onClick={onClick}
    />
  );
}

function SeriesLock() {
  return (
    <span className="tool-series-lock" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />
      </svg>
    </span>
  );
}
