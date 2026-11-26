import { useEffect, useRef, useState } from "react";
import { patchWidget, type BoardDocument } from "@remo/doc";
import { FRAME_LABEL, type Camera, type CanvasPalette } from "@remo/canvas";
import { ink as inkOn, rotatedBounds, rotationOf } from "@remo/model";
import type { Widget } from "@remo/model";
import { Icon, Menu, type MenuItem } from "@remo/ui";
import { useI18n } from "./i18n";
import { setSectionView } from "./sectionView";
import { closeFrameLabelEdit, useFrameLabelEdit } from "./frameLabelEditStore";

const VIEW_BADGE_HEIGHT = 22;

/**
 * The section title and the view badge on the canvas (ADR-207).
 *
 * Both are chrome: screen-space, above the section, outside its box. The title is a
 * button that selects and renames; the badge is a menu trigger for the same view switch
 * the panel uses. Nothing here is a document field except `frame.title`.
 */
export function SectionTitleLayer({
  board,
  widgets,
  camera,
  viewport,
  selectedIds,
  readOnly,
  presenting,
  onSelect,
  onNotice,
  palette,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  selectedIds: readonly string[];
  readOnly: boolean;
  presenting: boolean;
  onSelect: (ids: string[]) => void;
  onNotice?: (text: string) => void;
  /** The canvas palette: an empty label's placeholder is the canvas ground's ink. */
  palette: CanvasPalette;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [menu, setMenu] = useState<{ frame: Widget; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelRequest = useFrameLabelEdit();

  useEffect(() => {
    if (!labelRequest) return;
    closeFrameLabelEdit();
    const frame = widgets.find((widget) => widget.id === labelRequest && widget.type === "frame");
    if (!frame || readOnly || frame.locked) return;
    onSelect([frame.id]);
    setEditing({ id: frame.id, draft: frame.title ?? "" });
  }, [labelRequest, onSelect, readOnly, widgets]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  if (presenting || camera.zoom < 0.2) return null;

  const commit = (value?: string) => {
    if (!editing) return;
    const frame = widgets.find((widget) => widget.id === editing.id);
    const next = (value ?? editing.draft).trim();
    if (frame && next !== (frame.title ?? "")) {
      patchWidget(board, frame.id, { title: next });
    }
    setEditing(null);
  };

  const switchView = (frame: Widget, view: "free" | "table") => {
    const wasTable = frame.layout?.kind === "table" && frame.layout.active !== false;
    setSectionView(board, frame.id, view, t);
    onSelect([frame.id]);
    if (view === "free" && wasTable) onNotice?.(t("section.view.removed"));
    setMenu(null);
  };

  const menuItems = (frame: Widget): MenuItem[] => {
    const table = frame.layout?.kind === "table" && frame.layout.active !== false;
    return [
      {
        label: t("section.view.section"),
        checked: !table,
        onSelect: () => switchView(frame, "free"),
      },
      {
        label: t("section.view.table"),
        checked: table,
        onSelect: () => switchView(frame, "table"),
      },
    ];
  };

  const frames = widgets.filter((widget) => widget.type === "frame");

  return (
    <>
      <div className="section-titles" aria-hidden="false">
        {frames.map((frame) => {
          // The strip is the frame's own plate in screen space, so a turned frame turns
          // it about the frame's centre (ADR-271, T18).
          const angle = rotationOf(frame);
          const box = rotatedBounds(frame);
          const left = (box.x - camera.x) * camera.zoom + viewport.width / 2;
          const top = (box.y - camera.y) * camera.zoom + viewport.height / 2;
          const right = left + box.width * camera.zoom;
          const centreX = (frame.x - camera.x) * camera.zoom + viewport.width / 2;
          const centreY = (frame.y - camera.y) * camera.zoom + viewport.height / 2;
          if (right < 0 || left > viewport.width) return null;
          const selected = selectedIds.length === 1 && selectedIds[0] === frame.id;
          const table = frame.layout?.kind === "table" && frame.layout.active !== false;
          const title = frame.title?.trim() ?? "";
          const isEditing = editing?.id === frame.id;
          // The control sits exactly over the painted plate (ADR-267): the canvas draws
          // the name in the export, and this invisible button gives it focus and a field.
          const labelHeight = FRAME_LABEL.height * camera.zoom;
          const stripHeight = Math.max(labelHeight, 20);
          const labelOffset = (FRAME_LABEL.height - FRAME_LABEL.gap) * camera.zoom;
          const labelTop = top - labelOffset;
          // The fixed-size badge must sit above the table header even when the plate shrinks.
          const badgeOverlap = Math.max(0, (stripHeight + VIEW_BADGE_HEIGHT) / 2 - labelOffset);
          const turnedStyle = angle
            ? {
                left: 0,
                top: 0,
                transformOrigin: "0 0",
                transform: `translate(${centreX}px, ${centreY}px) rotate(${angle}deg) translate(${((-frame.width / 2) * camera.zoom).toFixed(2)}px, ${(-frame.height / 2 * camera.zoom - labelOffset).toFixed(2)}px)`,
              }
            : { left, top: labelTop };
          return (
            <div
              key={frame.id}
              className={`section-title-strip${selected ? " is-selected" : ""}`}
              style={{
                ...turnedStyle,
                height: stripHeight,
                // The placeholder sits above the frame, on the canvas ground (ADR-273).
                ["--ink" as string]: inkOn(palette.canvas, "muted"),
              }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="section-title-input"
                  value={editing.draft}
                  aria-label={t("section.title.rename")}
                  maxLength={2000}
                  onChange={(event) =>
                    setEditing({ id: frame.id, draft: event.currentTarget.value })
                  }
                  onBlur={(event) => commit(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commit(event.currentTarget.value);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={`section-title${title ? " is-inked" : " is-empty"}`}
                  style={title ? { height: Math.max(labelHeight, 20), fontSize: 13 * camera.zoom } : undefined}
                  aria-label={t("section.title.rename")}
                  title={title || undefined}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== "F2" && event.key !== " ") return;
                    event.preventDefault();
                    if (readOnly || frame.locked) return;
                    setEditing({ id: frame.id, draft: title });
                  }}
                >
                  {title || t("section.title.placeholder")}
                </button>
              )}
              {table && (
                <button
                  type="button"
                  className="section-view-badge"
                  style={{ height: VIEW_BADGE_HEIGHT, transform: `translateY(${-badgeOverlap}px)` }}
                  disabled={readOnly || Boolean(frame.locked)}
                  aria-haspopup="menu"
                  aria-expanded={menu?.frame.id === frame.id}
                  aria-label={`${t("section.view.label")}: ${t("section.view.table")}`}
                  title={frame.locked ? t("section.view.locked") : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect([frame.id]);
                    const box = event.currentTarget.getBoundingClientRect();
                    setMenu({ frame, x: box.left, y: box.bottom + 4 });
                  }}
                >
                  <Icon name="table" size={14} />
                  {t("section.view.table")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <div className="section-view-menu" style={{ left: menu.x, top: menu.y }}>
          <Menu
            label={t("section.view.label")}
            items={menuItems(menu.frame)}
            onClose={() => setMenu(null)}
          />
        </div>
      )}
    </>
  );
}
