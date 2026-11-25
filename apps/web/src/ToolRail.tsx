import { useEffect, useMemo, useRef } from "react";
import type { ConnectorRouting, ShapeKind } from "@remo/model";
import { Icon, IconButton, Popover, Separator, Tooltip } from "@remo/ui";
import type { IconName } from "@remo/ui";
import { useI18n, type TranslationKey } from "./i18n";
import { useChromeQuiet } from "./quietChrome";
import { COLOR_WINDOW_WIDTH, ColorSwatch } from "./object-panel/ColorWindow";
import {
  defaultStickerFill,
  type NamedFillChoice,
  type NoteFillChoice,
} from "./object-panel/palette";
import { ShapeKindList } from "./object-panel/ShapeKindPicker";
import { HelpLink } from "./help/HelpLink";

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
  noteExtras,
  noteFill,
  armedShape,
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
  /** The named chips beside the grid — White and Black (ADR-140). */
  noteExtras: readonly NamedFillChoice[];
  /** The fill the next note takes; it is what the flyout rings (ADR-266 §10a). */
  noteFill: string;
  /** The shape waiting for a drag on the canvas (ADR-271). */
  armedShape: ShapeKind | null;
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
  const defaultFill = useMemo(() => defaultStickerFill(), []);

  useEffect(() => {
    if (!flyout) return;
    const onDown = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) onFlyout(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFlyout(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
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
          onClick={options.onClick}
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
          expanded: armedShape === null && flyout === null,
          onClick: onSelect,
        })}

        <div className="tool-rail-item">
          {tool({
            icon: "sticky",
            label: "tool.sticky",
            shortcut: "N",
            disabled: writeBlocked,
            expanded: flyout === "sticky",
            onClick: () => {
              // The active tool explains its variants; a tool that is off acts at once.
              if (flyout === "sticky") onFlyout(null);
              else onSticky(noteFill);
            },
          })}
          <ToolDisclosure
            label={t("tool.stickyColors")}
            open={flyout === "sticky"}
            disabled={writeBlocked}
            onClick={() => onFlyout(flyout === "sticky" ? null : "sticky")}
          />
          {flyout === "sticky" && (
            <Popover
              title={t("tool.stickyColors")}
              width={COLOR_WINDOW_WIDTH}
              side="right"
              onClose={() => onFlyout(null)}
            >
              <div className="tool-flyout-palette" role="group" aria-label={t("tool.stickyColors")}>
                <div className="tool-flyout-extras">
                  {noteExtras.map((extra) => (
                    <ColorSwatch
                      key={extra.id}
                      hex={extra.value}
                      word={t(extra.key)}
                      className="tool-extra"
                      onClick={() => {
                        onSticky(extra.value);
                        onFlyout(null);
                      }}
                    />
                  ))}
                </div>
                <div className="tool-flyout-swatches">
                  {noteColors.map((color) => (
                    <ColorSwatch
                      key={`${color.tone}-${color.level}`}
                      hex={color.hex}
                      word={t(color.key)}
                      dataHex={color.hex}
                      className={
                        color.hex === noteFill
                          ? "tool-swatch is-default"
                          : "tool-swatch"
                      }
                      onClick={() => {
                        onSticky(color.hex);
                        onFlyout(null);
                      }}
                    />
                  ))}
                </div>
              </div>
              <p className="tool-flyout-note">
                {noteFill === defaultFill ? t("tool.stickyDefault") : t("tool.stickyRemembered")}{" "}
                <HelpLink topicId="room.colours" className="help-link icon-link" />
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
            onClick: () => {
              // An armed tool explains its five silhouettes; a fresh one arms.
              if (armedShape !== null) onFlyout(flyout === "shape" ? null : "shape");
              else onShape(defaultShape);
            },
            onDoubleClick: () => onShapeSeries(armedShape ?? defaultShape),
          })}
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

        {tool({
          icon: "text",
          label: "tool.text",
          shortcut: "T",
          disabled: writeBlocked,
          onClick: onText,
        })}

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
            iconSize={20}
            className="tool-rail-button"
            disabled={writeBlocked || !canUndo}
            onClick={onUndo}
          />
        </Tooltip>
        <Tooltip side="right" label={t("board.redo")}>
          <IconButton
            icon="redo"
            label={t("board.redo")}
            iconSize={20}
            className="tool-rail-button"
            disabled={writeBlocked || !canRedo}
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
  label,
  open,
  disabled,
  onClick,
}: {
  label: string;
  open: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tool-rail-caret${open ? " open" : ""}`}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
