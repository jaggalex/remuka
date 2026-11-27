import { useEffect, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import type { ConnectionStatus, Presence } from "@remo/doc";
import { NAMED_COLORS, soleSelectedGroup, type KanbanState, type Tag, type Widget } from "@remo/model";
import { api } from "./api";
import { commandById, runCommand, type CommandContext } from "./commands";
import { noteFontSizeFor, textCapFor, textFloorFor } from "@remo/canvas";
import type { BoardSettings } from "./settings";
import { DEFAULT_INK } from "./objectDefaults";
import type { StickyBarActions } from "./object-panel/stickyTypes";
import { addColumn, addSwimlane, groupNameOf } from "@remo/doc";
import { currentRoom } from "./identity";
import { CardColour, CardRecord, CardStatusBadge, CardTags } from "./CardRecord";
import { CardFilterPanel } from "./CardFilterPanel";
import { Button, Checkbox, Disclosure, DangerZone, IconButton, Select } from "@remo/ui";
import { HelpLink } from "./help/HelpLink";

import { useI18n } from "./i18n";
import {
  GroupNameField,
  ObjectLinkPanel,
  ObjectNameField,
  TagsPanel,
} from "./BoardObjectPanels";
import { Contained } from "./ErrorBoundary";
import { SectionPanel } from "./SectionPanel";
import { SelectionActions } from "./SelectionActions";
import { TableCellPanel } from "./TableCellPanel";
import { PropertiesFrequent } from "./object-panel/PropertiesFrequent";
import { TextMoreControls } from "./object-panel/TextMoreControls";
import { setGatherPreview } from "./gatherPreviewStore";

/**
 * Sync details are for a developer: a development build opened with `?debug`, the same
 * switch as the canvas cursor readout (ADR-236).
 */
const SYNC_DETAILS =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("debug");

/**
 * The board overview panel.
 *
 * Overview, selection actions, document counts, kanban state and the technical honesty
 * section. It is presentational: every action is a command App already owns, so the
 * panel cannot invent a second path to the document (ADR-093/Q4.2).
 */
export interface BoardInspectorProps {
  toggleInspector: () => void;
  onNotice: (message: string) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  writeBlocked: boolean;
  commandContext: CommandContext;
  widgets: Widget[];
  board: BoardDocument;
  setWidgetPositions: (
    board: BoardDocument,
    positions: { id: string; x: number; y: number }[],
  ) => void;
  canJoinSelection: boolean;
  connectSelection: () => void;
  setEditingId: (id: string | null) => void;
  selectionLocked: boolean;
  counts: Array<[string, number]>;
  kanbanStates: Record<string, KanbanState>;
  status: ConnectionStatus;
  visiblePresence: Presence[];
  /** Open a board deep link, e.g. an internal link target. */
  onOpenObject: (boardId: string, widgetId: string) => void;
  /** The frequent controls write through the bar's own actions (T8). */
  stickyActions: StickyBarActions;
  settings: BoardSettings;
  /** The object whose text is open: the panel then carries the rest of the formats. */
  editingId: string | null;
  /** Gather the selection into one section (moved here from the bar in T8). */
  onGather: (ids: readonly string[]) => void;
}

/**
 * The inspector inside its own failure boundary (ADR-171): an object the panel cannot
 * show closes the panel, not the room, and selecting something else retries.
 */
export function BoardInspector(props: BoardInspectorProps) {
  return (
    <Contained scope="panel" resetKey={props.selectedIds.join(",")}>
      <InspectorBody {...props} />
    </Contained>
  );
}

function InspectorBody(props: BoardInspectorProps) {
  const { t, typeName, statusName } = useI18n();
  const {
    toggleInspector, selectedIds, setSelectedIds, writeBlocked,
    commandContext, widgets, board, setWidgetPositions, canJoinSelection,
    connectSelection, setEditingId, selectionLocked, counts, kanbanStates,
    status, visiblePresence, onOpenObject, stickyActions, settings, editingId, onGather,
  } = props;
  const groupId = soleSelectedGroup(widgets, selectedIds);
  const card =
    selectedIds.length === 1
      ? widgets.find((widget) => widget.id === selectedIds[0] && widget.type === "card")
      : undefined;
  const selectedWidget =
    selectedIds.length === 1 ? widgets.find((widget) => widget.id === selectedIds[0]) : undefined;
  const section =
    selectedWidget?.type === "frame" ? selectedWidget : undefined;
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!card) return;
    let alive = true;
    api
      .boardPeople(currentRoom())
      .then((result) => {
        if (alive) setPeople(result.people);
      })
      .catch(() => {
        if (alive) setPeople([]);
      });
    return () => {
      alive = false;
    };
  }, [card?.id]);

  // One subject at a time (ADR-236): the room when nothing is selected, a kanban when one
  // is, otherwise the selection. Room-wide content never shows beside another subject.
  const kanban =
    selectedWidget?.type === "kanban" && kanbanStates[selectedWidget.id]
      ? { id: selectedWidget.id, state: kanbanStates[selectedWidget.id]! }
      : null;
  const subject = selectedIds.length === 0 ? "room" : kanban ? "kanban" : "selection";
  // The header names the subject: its kind, then its own name (ADR-236, sketch D4).
  // The mockup's title is the kind of the selected object; a name a person gave it
  // still wins, because that is what they look for (ADR-165, ADR-286).
  const kicker = subject === "room" ? t("inspector.kindRoom") : null;
  const kindName = selectedWidget
    ? section?.layout?.kind === "table"
      ? t("inspector.kindTable", { kind: typeName("frame") })
      : typeName(selectedWidget.type)
    : null;
  const heading =
    subject === "room"
      ? board.title || t("board.untitled")
      : selectedWidget
        ? selectedWidget.name || kindName || typeName(selectedWidget.type)
        : t("inspector.selection", { count: selectedIds.length });
  // One help per panel, about the subject it shows.
  const helpTopic = section ? "section.table" : card ? "cards.fields" : "room.panel";
  const assignedTags = (selectedWidget?.tagIds ?? [])
    .map(id => board.tags.get(id) as Tag | undefined)
    .filter((tag): tag is Tag => Boolean(tag));
  const tagNames = assignedTags.map(tag => tag.name).join(", ");
  const nameValue = selectedWidget?.name || (selectedWidget?.link ? t("inspector.hasLink") : t("inspector.none"));
  const runs = selectedWidget?.runs?.length
    ? selectedWidget.runs
    : [{ text: selectedWidget?.content ?? selectedWidget?.title ?? "" }];
  const autoSize = selectedWidget
    ? noteFontSizeFor(
        runs,
        selectedWidget.width,
        selectedWidget.height,
        textCapFor(selectedWidget, settings.notes.fontCap),
        undefined,
        textFloorFor(selectedWidget),
        settings.text.fontFamily,
      ) ?? 16
    : 16;
  const parent = selectedWidget?.parentId
    ? widgets.find((widget) => widget.id === selectedWidget.parentId)
    : undefined;
  const inTable =
    parent?.type === "frame" && parent.layout?.kind === "table" && parent.layout.active !== false;
  // A note, a shape and text have a frequent half; everything else is its fields.
  const frequentSubject =
    !!selectedWidget && ["sticky_note", "shape", "text"].includes(selectedWidget.type);
  const deleteCommand = commandById("delete");
  const editCommand = commandById("editText");
  const lockCommand = commandById("lock");

  const tagEditor = <TagsPanel board={board} widgets={widgets} selectedIds={selectedIds}
    setSelectedIds={setSelectedIds} disabled={writeBlocked} />;
  const tags = (
    <Disclosure label={t("tags.title")} value={tagNames || t("inspector.none")} className="tags-fold">
      {tagEditor}
    </Disclosure>
  );
  const matrix = card?.parentId ? kanbanStates[card.parentId] : undefined;
  const cardColumn = card && matrix?.columns.find(column => column.id === matrix.cards[card.id]?.columnId);
  const cardDisabled = writeBlocked || Boolean(card?.locked);

  return (
        <aside
          className={card ? "inspector card-fields" : "inspector"}
          aria-label={t("inspector.overview")}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Escape in the panel closes the panel, not the selection under it.
            event.stopPropagation();
            toggleInspector();
          }}
        >
          <div className="inspector-head">
            <div className="inspector-subject">
              {kicker && <span className="inspector-kicker">{kicker}</span>}
              <h2 className="inspector-title">{heading}</h2>
            </div>
            {card && <CardStatusBadge board={board} card={card} disabled={cardDisabled} />}
            <HelpLink topicId={helpTopic} label={t("inspector.help")} className="help-link icon-link" />
            <IconButton icon="close" size="compact" label={t("inspector.hide")} onClick={toggleInspector} />
          </div>

          <div className="inspector-body">
          {card && (
            <div className="card-record">
              <CardRecord board={board} card={card} people={people} disabled={cardDisabled} />
              <CardTags assigned={assignedTags}>{tagEditor}</CardTags>
              <CardColour board={board} card={card} column={cardColumn || undefined} disabled={cardDisabled} />
            </div>
          )}
          {subject === "room" && (
            <>
              <h3 className="inspector-group">{t("inspector.contents")}</h3>
              <ul className="counts">
                {counts.map(([type, total]) => (
                  <li key={type}>
                    <span>{typeName(type)}</span>
                    <b>{total}</b>
                  </li>
                ))}
              </ul>
              <CardFilterPanel widgets={widgets} setSelectedIds={setSelectedIds} onNotice={props.onNotice} />
            </>
          )}

          {selectedIds.length > 0 && (
            <>
              {selectedWidget && (
                <PropertiesFrequent
                  widget={selectedWidget}
                  actions={stickyActions}
                  autoSize={autoSize}
                  disabled={writeBlocked}
                />
              )}

              {selectedWidget ? (
                <Disclosure
                  label={t("properties.more")}
                  value={kindName ?? t("inspector.none")}
                  className="properties-more"
                  // The card record precedes this fold. Sections and kanbans keep their fields here.
                  open={Boolean(selectedWidget) && ((!card && !frequentSubject) || inTable)}
                >
                  <SelectionActions
                    showElevation={selectedWidget.type !== "shape"}
                    commandContext={commandContext}
                    widgets={widgets}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    board={board}
                    setWidgetPositions={setWidgetPositions}
                    canJoinSelection={canJoinSelection}
                    connectSelection={connectSelection}
                    setEditingId={setEditingId}
                    selectionLocked={selectionLocked}
                    writeBlocked={writeBlocked}
                  />
                  {selectedWidget && editingId === selectedWidget.id && <TextMoreControls />}
                  <div className="properties-row properties-row-wrap">
                    {editCommand &&
                      ["sticky_note", "shape", "text"].includes(selectedWidget.type) && (
                        <Button
                          variant="ghost"
                          size="compact"
                          icon="pencil"
                          disabled={!editCommand.enabled(commandContext)}
                          onClick={() => runCommand(editCommand, commandContext)}
                        >
                          {t("inspector.editText")}
                        </Button>
                      )}
                    {lockCommand && (
                      <Checkbox
                        label={t("properties.pin")}
                        checked={Boolean(selectedWidget.locked)}
                        disabled={writeBlocked}
                        onChange={() => runCommand(lockCommand, commandContext)}
                      />
                    )}
                  </div>
                  {["sticky_note", "shape"].includes(selectedWidget.type) && (
                    <Select
                      size="compact"
                      label={t("properties.textColour")}
                      options={[
                        { value: "", label: t("sticky.inkAuto") },
                        { value: DEFAULT_INK, label: t("color.inkDark") },
                        { value: NAMED_COLORS.white, label: t("color.inkWhite") },
                      ]}
                      value={selectedWidget.style?.textColor ?? ""}
                      disabled={writeBlocked}
                      onChange={(event) =>
                        stickyActions.setInk(event.target.value || null)
                      }
                    />
                  )}
                  {["sticky_note", "shape", "text"].includes(selectedWidget.type) &&
                    editingId !== selectedWidget.id && (
                      <div className="properties-row properties-row-wrap">
                        <Button
                          variant="ghost"
                          size="compact"
                          icon="plus"
                          disabled={writeBlocked}
                          onClick={() => stickyActions.setLineIndent(1)}
                        >
                          {t("sticky.indentMore")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="compact"
                          icon="minus"
                          disabled={writeBlocked}
                          onClick={() => stickyActions.setLineIndent(-1)}
                        >
                          {t("sticky.indentLess")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="compact"
                          icon="clear-format"
                          disabled={writeBlocked}
                          onClick={() => stickyActions.clearFormatting()}
                        >
                          {t("sticky.clearFormatting")}
                        </Button>
                      </div>
                    )}
                  {selectedWidget.type === "connector" &&
                    Boolean(selectedWidget.content?.trim()) && (
                      <div className="properties-group">
                        <h3 className="properties-heading">{t("line.labelSize")}</h3>
                        <div className="properties-row">
                          <Button
                            variant="ghost"
                            size="compact"
                            selected={selectedWidget.style?.fontSize == null}
                            disabled={writeBlocked}
                            onClick={() => stickyActions.setFont(null)}
                          >
                            {t("sticky.auto")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="compact"
                            disabled={writeBlocked}
                            onClick={() =>
                              stickyActions.setFont(
                                Math.max(6, (selectedWidget.style?.fontSize ?? 13) - 1),
                              )
                            }
                          >
                            A−
                          </Button>
                          <Button
                            variant="ghost"
                            size="compact"
                            disabled={writeBlocked}
                            onClick={() =>
                              stickyActions.setFont(
                                Math.min(96, (selectedWidget.style?.fontSize ?? 13) + 1),
                              )
                            }
                          >
                            A+
                          </Button>
                        </div>
                      </div>
                    )}
                  {kanban && (
                    <KanbanStatePanel board={board} id={kanban.id} state={kanban.state} writeBlocked={writeBlocked} />
                  )}
                  {groupId && (
                    <GroupNameField
                      board={board}
                      groupId={groupId}
                      name={groupNameOf(board, groupId)}
                      disabled={writeBlocked}
                    />
                  )}
                  {section && (
                    <SectionPanel
                      board={board}
                      frame={section}
                      widgets={widgets}
                      writeBlocked={writeBlocked}
                      onDeleted={() => setSelectedIds([])}
                    />
                  )}
                  {!section && (
                    <TableCellPanel
                      board={board}
                      widgets={widgets}
                      selectedIds={selectedIds}
                      writeBlocked={writeBlocked}
                    />
                  )}
                  <Disclosure label={t("inspector.nameAndLink")} value={nameValue} className="name-link-fold">
                    <ObjectNameField board={board} widget={selectedWidget} disabled={writeBlocked} />
                    <ObjectLinkPanel
                      board={board}
                      widget={selectedWidget}
                      widgets={widgets}
                      disabled={writeBlocked}
                      onOpenObject={onOpenObject}
                    />
                  </Disclosure>
                  {!card && tags}
                </Disclosure>
              ) : (
                <>
                  <SelectionActions
                    commandContext={commandContext}
                    widgets={widgets}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    board={board}
                    setWidgetPositions={setWidgetPositions}
                    canJoinSelection={canJoinSelection}
                    connectSelection={connectSelection}
                    setEditingId={setEditingId}
                    selectionLocked={selectionLocked}
                    writeBlocked={writeBlocked}
                  />
                  {groupId && (
                    <GroupNameField
                      board={board}
                      groupId={groupId}
                      name={groupNameOf(board, groupId)}
                      disabled={writeBlocked}
                    />
                  )}
                  {selectedIds.length > 1 && (
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => onGather(selectedIds)}
                      onPointerEnter={() => setGatherPreview(true)}
                      onPointerLeave={() => setGatherPreview(false)}
                      onFocus={() => setGatherPreview(true)}
                      onBlur={() => setGatherPreview(false)}
                    >
                      {t("selection.gather")}
                    </Button>
                  )}
                  {tags}
                </>
              )}
            </>
          )}

          {/* A developer's instrument, not a product readout (ADR-236): the person has the
              save icon in the header. */}
          {SYNC_DETAILS && (
            <details className="inspector-tech">
              <summary>{t("inspector.tech")}</summary>
              <p className="muted">{t("inspector.documentNote")}</p>
              <div className="history-row">
                <span>
                  {t("inspector.undoStack")} <b>{board.undo.undoStack.length}</b>
                </span>
                <span>
                  {t("inspector.redoStack")} <b>{board.undo.redoStack.length}</b>
                </span>
              </div>
              <div className="history-row">
                <span>
                  {t("inspector.room")} <b>{currentRoom()}</b>
                </span>
                <span>
                  {t("inspector.sync")} <b>{statusName(status)}</b>
                </span>
              </div>
              <div className="history-row">
                <span>
                  {t("inspector.inRoom")} <b>{visiblePresence.length}</b>
                </span>
                <span className="muted">
                  {visiblePresence
                    .map((p) => (p.self ? t("board.peerYou", { name: p.label }) : p.label))
                    .join(", ")}
                </span>
              </div>
            </details>
          )}
          </div>

          {selectedIds.length > 0 && (
            <DangerZone title={t("menu.delete")} description={t("properties.deleteUndo")}>
              <Button
                variant="ghost-danger"
                size="compact"
                icon="trash"
                disabled={writeBlocked || !deleteCommand?.enabled(commandContext)}
                onClick={() => deleteCommand && runCommand(deleteCommand, commandContext)}
              >
                {t("inspector.delete")}
              </Button>
            </DangerZone>
          )}
        </aside>
  );
}

/** A selected kanban's state (ADR-236): its columns, swimlanes and WIP limits. */
function KanbanStatePanel({
  board,
  id,
  state,
  writeBlocked,
}: {
  board: BoardDocument;
  id: string;
  state: KanbanState;
  writeBlocked: boolean;
}) {
  const { t, count } = useI18n();
  return (
    <div className="kanban-state">
      <h3 className="inspector-group">{t("inspector.kanban")}</h3>
      <div className="kanban-state-head">
        {count("columns", state.columns.length)} × {count("swimlanes", state.swimlanes.length)}
      </div>
      <div className="muted">
        {count("cards", Object.keys(state.cards).length)} ·{" "}
        {t("inspector.newColumnWidth", { width: Math.round(state.newColumnWidth) })}
      </div>
      <div className="chips">
        {state.columns.map((column) => (
          <span key={column.id} className="chip">
            {column.title}{" "}
            <b>{Object.values(state.cards).filter((p) => p.columnId === column.id).length}</b>
          </span>
        ))}
      </div>
      <div className="kanban-actions">
        <Button variant="ghost" size="compact" disabled={writeBlocked} onClick={() => addColumn(board, id)}>
          {t("inspector.addColumn")}
        </Button>
        <Button variant="ghost" size="compact" disabled={writeBlocked} onClick={() => addSwimlane(board, id)}>
          {t("inspector.addSwimlane")}
        </Button>
      </div>
    </div>
  );
}
