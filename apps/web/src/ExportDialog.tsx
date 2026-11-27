import { useOrgBilling } from "./useOrgBilling";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  loadBoard,
  setWidgetDelta,
  type BoardDocument,
} from "@remo/doc";
import type { Tag, Board, KanbanState, TextDeltaOp, Widget } from "@remo/model";
import { Button, Checkbox, Dialog, Icon } from "@remo/ui";
import { api, ApiError } from "./api";
import { planLimitFrom, type PlanLimitNotice } from "./apiBilling";
import { PlanNotice } from "./PlanNotice";
import {
  backupToBoard,
  BackupError,
  verifyBoardBackup,
  type BoardBackup,
} from "./backupFormat";
import { commentsApi, type BackupCommentThread, type CommentThread } from "./commentsApi";
import { canvasPaletteFromTokens } from "./canvasPalette";
import {
  buildPdfFromJpeg,
  canvasToBlob,
  frameForSelection,
  preloadExportImages,
  renderScope,
  scopeWidgets,
  type ExportScope,
} from "./exportRender";
import { brandName } from "@remo/brand";
import { useI18n } from "./i18n";
import type { BoardSettings } from "./settings";

type Format = "png" | "pdf" | "backup";
type Status = "idle" | "running" | "done" | "error";

interface PendingImport {
  filename: string;
  objects: number;
  /**
   * A version 3 backup with an `assets` section is restored by the server, which owns
   * the file pipeline and the `fileId` rewrite. Versions without it keep the client
   * path: there is nothing to upload, so the old mechanism is still the right one.
   */
  bundle?: BoardBackup;
  board?: Board;
  kanbanStates?: Record<string, KanbanState>;
  textDeltas?: Record<string, TextDeltaOp[]>;
  comments?: BackupCommentThread[];
}

/**
 * Export and backup (ADR-071).
 *
 * A backup is always the whole board. For PNG and PDF, the selected scope determines
 * what leaves the room. With no selection, the dialog starts on the whole room and
 * offers its only frame when there is exactly one (ADR-301).
 */
export function ExportDialog({
  open,
  boardId,
  boardTitle,
  orgId,
  board,
  widgets,
  kanbanStates,
  selectedIds,
  settings,
  canExport,
  canBackup,
  canImport,
  restoreRequest,
  onOpenBilling,
  onClose,
  onImported,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  orgId?: string | null;
  board: BoardDocument;
  widgets: Widget[];
  kanbanStates: Record<string, KanbanState>;
  selectedIds: readonly string[];
  settings: BoardSettings;
  canExport: boolean;
  canBackup: boolean;
  canImport: boolean;
  /**
   * Increments when the board menu asked for a restore: the dialog then opens on its
   * restore section. The separate `RestoreDialog` of ADR-122 is stage S3, so until then
   * one entry point leads here instead of two copies of the same verify-and-replace code.
   */
  restoreRequest?: number;
  /** A `402` offers the plan screen; the board owns the one organisation dialog. */
  onOpenBilling?: () => void;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t, count, productName, stage } = useI18n();
  const billing = useOrgBilling(orgId ?? null, open);
  const pdfPlan = billing.seed && !billing.seed.features.includes("export.pdf") ? billing.seed.featurePlans?.["export.pdf"] : undefined;
  const [scope, setScope] = useState<ExportScope | null>(null);
  const [format, setFormat] = useState<Format>("png");
  const [status, setStatus] = useState<Status>("idle");
  const [stageLabel, setStageLabel] = useState<"preparing" | "rendering" | "saving">("preparing");
  const activeExport = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitNotice | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [includeComments, setIncludeComments] = useState(false);
  /** The room is over the 200 MiB backup limit: the offer, not a dead end (§5.3). */
  const [backupTooLarge, setBackupTooLarge] = useState(false);
  /** Pictures the export could not decode: a placeholder is in the picture (§6.1). */
  const [imageWarning, setImageWarning] = useState(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const importSection = useRef<HTMLDetailsElement | null>(null);
  const handledRestore = useRef(0);

  const frame = useMemo(
    () => frameForSelection(widgets, selectedIds),
    [widgets, selectedIds],
  );

  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.length ? "selection" : "board");
    setFormat(canExport ? "png" : "backup");
    setStatus("idle");
    setStageLabel("preparing");
    setError(null);
    setPlanLimit(null);
    setJobId(null);
    setPendingImport(null);
    setImportError(null);
    setImportBusy(false);
    setBackupTooLarge(false);
    setImageWarning(0);
    return () => activeExport.current?.abort();
    // The reset is about opening, not about every change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A restore request scrolls to the one place that replaces the board.
  useEffect(() => {
    if (!open || !restoreRequest || restoreRequest === handledRestore.current || !canImport || !importSection.current) return;
    handledRestore.current = restoreRequest;
    importSection.current.open = true;
    importSection.current?.scrollIntoView({ block: "nearest" });
    importSection.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [canImport, open, restoreRequest]);

  const effectiveScope: ExportScope | null = format === "backup" ? "board" : scope;
  const scoped = useMemo(
    () =>
      effectiveScope ? scopeWidgets(widgets, selectedIds, effectiveScope) : [],
    [widgets, selectedIds, effectiveScope],
  );
  const objectCount = format === "backup" ? widgets.length : scoped.length;

  const canRun =
    status !== "running" &&
    (format === "backup" ? canBackup : canExport) &&
    Boolean(effectiveScope) &&
    objectCount > 0;

  if (!open) return null;

  const failureText = (failure: unknown) => {
    const code = failure instanceof ApiError ? failure.code : "";
    if (code === "FORBIDDEN") return t("export.forbidden");
    if (failure instanceof Error && failure.message === "EMPTY_SCOPE") {
      return t("export.emptyScope");
    }
    if (failure instanceof Error && failure.message === "CANVAS_EMPTY") {
      return t("export.canvasFailed");
    }
    return t("export.failed");
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // A revoked URL after a tick still lets the browser start the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const run = async (options: { withoutImages?: boolean } = {}) => {
    if (!canRun || !effectiveScope) return;
    setStatus("running");
    setError(null);
    setPlanLimit(null);
    setBackupTooLarge(false);
    setImageWarning(0);
    const operation = new AbortController();
    activeExport.current = operation;
    setStageLabel("preparing");
    try {
      if (format === "backup") {
        // A room over 200 MiB is offered the same backup without pictures (§5.3): the
        // assets keep their metadata and lose their bytes.
        const result = await api.downloadBackup(boardId, options.withoutImages === true);
        operation.signal.throwIfAborted();
        download(result.blob, result.filename);
        setStatus("done");
        return;
      }

      let currentJob = jobId;
      if (!currentJob) {
        const created = await api.createExportJob(boardId, {
          scope: effectiveScope,
          format,
          objectCount,
        });
        operation.signal.throwIfAborted();
        currentJob = created.jobId;
        setJobId(currentJob);
      }
      setStageLabel("rendering");

      await document.fonts?.ready;
      const palette = canvasPaletteFromTokens();
      let comments: CommentThread[] = [];
      if (includeComments) {
        // The discussion is a server read; a failure must not block the picture.
        comments = await commentsApi.list(boardId).then((result) => result.threads).catch(() => []);
      }
      const theme = {
        fontFamily: settings.text.fontFamily,
        fontCap: settings.notes.fontCap,
        shapeStrokeWidth: settings.shapes.strokeWidth,
        cardPlaceholder: t("kanban.cardPlaceholder"),
        kanbanTitle: t("canvas.kanbanPlate"),
        timerExpired: t("facilitation.timer.timeUp"),
        imageUnavailable: t("canvas.imageUnavailable"),
        cardStatus: {
          todo: t("card.status.todo"),
          in_progress: t("card.status.in_progress"),
          done: t("card.status.done"),
        },
        palette,
        // The same card faces as on screen, tags included (ADR-106).
        tags: new Map(
          Object.values(board.tags.toJSON() as Record<string, Tag>).map((tag) => [tag.id, tag]),
        ),
      };
      // Pictures are decoded before the synchronous render; one that does not arrive
      // in time becomes a placeholder rather than an empty hole (§6.1).
      const images = await preloadExportImages({
        widgets,
        kanbanStates,
        selectedIds,
        scope: effectiveScope,
      });
      operation.signal.throwIfAborted();
      const rendered = renderScope({
        widgets,
        kanbanStates,
        selectedIds,
        scope: effectiveScope,
        settings,
        comments,
        includeComments,
        commentsTitle: t("export.commentsTitle"),
        commentPointLabel: t("export.commentsPoint"),
        theme,
        image: images.image,
        imageUnavailable: images.unavailable,
        // One painter marks both PNG and PDF, because the PDF is built from this canvas.
        watermark: stage ? t("stage.watermark") : null,
      });
      if (!rendered) throw new Error("EMPTY_SCOPE");

      if (format === "png") {
        const blob = await canvasToBlob(rendered.canvas, "image/png");
        operation.signal.throwIfAborted();
        setStageLabel("saving");
        await api.completeExportJob(boardId, currentJob, blob.size);
        operation.signal.throwIfAborted();
        download(blob, filenameFor(boardTitle, "png"));
      } else {
        const jpeg = await canvasToBlob(rendered.canvas, "image/jpeg", 0.92);
        const bytes = new Uint8Array(await jpeg.arrayBuffer());
        const pdf = buildPdfFromJpeg(
          bytes,
          rendered.width,
          rendered.height,
          brandName({ locale: "en", productName }),
        );
        operation.signal.throwIfAborted();
        setStageLabel("saving");
        await api.completeExportJob(boardId, currentJob, pdf.size);
        operation.signal.throwIfAborted();
        download(pdf, filenameFor(boardTitle, "pdf"));
      }
      // A picture that did not arrive in 15 s is in the file as a placeholder; saying so
      // beats letting the person discover it later (§6.1).
      if (images.failed > 0) setImageWarning(images.failed);
      setStatus("done");
      setJobId(null);
    } catch (failure) {
      if (operation.signal.aborted) return;
      // The job id stays, so "retry" resumes the same audited request instead of
      // creating a second `export.requested` for one click. A plan refusal is shown as
      // an offer to change the plan, not as a broken export.
      const notice = planLimitFrom(failure);
      if (notice) {
        setPlanLimit(notice);
        setStatus("idle");
        return;
      }
      // The 200 MiB ceiling is not an error the person can fix by retrying: it is an
      // offer of the backup without pictures (§5.3, §9.9).
      if (failure instanceof ApiError && failure.code === "BACKUP_TOO_LARGE") {
        setBackupTooLarge(true);
        setStatus("idle");
        return;
      }
      setError(failureText(failure));
      setStatus("error");
    }
  };

  const chooseFile = async (file: File) => {
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const bundle = await verifyBoardBackup(parsed);
      const { board: model, kanbanStates: states, textDeltas, comments } = backupToBoard(bundle);
      // `assets` present (even empty) is the version 3 shape: the server restores it.
      const server = Array.isArray(bundle.assets);
      setPendingImport({
        filename: file.name,
        objects: model.widgets.length,
        ...(server
          ? { bundle }
          : {
              board: model,
              kanbanStates: states,
              textDeltas,
              comments: comments as BackupCommentThread[],
            }),
      });
    } catch (failure) {
      setPendingImport(null);
      if (failure instanceof BackupError) {
        setImportError(
          failure.code === "NOT_A_BACKUP"
            ? t("export.importWrongFormat")
            : failure.code === "VERSION"
              ? t("export.importVersion")
              : failure.code === "CHECKSUM"
                ? t("export.importChecksum")
                : t("export.importShape"),
        );
        return;
      }
      setImportError(t("export.importWrongFormat"));
    }
  };

  const importFailureText = (failure: unknown) => {
    const code = failure instanceof ApiError ? failure.code : "";
    if (code === "TOO_LARGE") return t("export.importTooLarge");
    if (code === "BAD_TYPE") return t("export.importBadImage");
    return t("export.importFailed");
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setImportBusy(true);
    setImportError(null);

    if (pendingImport.bundle) {
      // Pictures are not document state: the server stores their bytes, rewrites every
      // `fileId`, applies the document and restores the discussion in one request.
      try {
        await api.importBackup(boardId, pendingImport.bundle);
      } catch (failure) {
        const notice = planLimitFrom(failure);
        if (notice) setPlanLimit(notice);
        setImportError(importFailureText(failure));
        setImportBusy(false);
        return;
      }
      setPendingImport(null);
      setImportBusy(false);
      onImported();
      return;
    }

    // A version 1 or 2 backup has no `assets` section and therefore no bytes: the local
    // replacement is still the whole operation.
    loadBoard(board, pendingImport.board!, pendingImport.kanbanStates!);
    for (const [id, delta] of Object.entries(pendingImport.textDeltas ?? {})) {
      setWidgetDelta(board, id, delta);
    }
    board.undo.clear();
    try {
      // The discussion is a server-side sibling of the document (ADR-104 amendment),
      // so replacing the board must replace it too; an empty backup clears it.
      await commentsApi.restore(boardId, pendingImport.comments ?? []);
    } catch (failure) {
      setImportError(failure instanceof Error ? failure.message : String(failure));
      setImportBusy(false);
      return;
    }
    setPendingImport(null);
    setImportBusy(false);
    onImported();
  };

  const navigateChoices = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:enabled'));
    const current = choices.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const index = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 :
      (current + direction + choices.length) % choices.length;
    const next = choices[index]!;
    next.focus();
    if (!next.dataset.paid) next.click();
  };

  const scopeOption = (
    value: ExportScope,
    title: string,
    hint: string,
    disabled: boolean,
    selected: boolean,
  ) => (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className={`export-choice${selected ? " selected" : ""}`}
      data-export-busy={!disabled && status === "running" || undefined}
      disabled={disabled || format === "backup" || status === "running"}
      onClick={() => setScope(value)}
    >
      <strong>{title}</strong>
      <span>{hint}</span>
    </button>
  );

  const formatOption = (value: Format, title: string, hint: string, enabled: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={format === value}
      data-paid={value === "pdf" && pdfPlan || undefined}
      tabIndex={format === value ? 0 : -1}
      className={`export-choice${format === value ? " selected" : ""}`}
      data-export-busy={enabled && status === "running" || undefined}
      disabled={!enabled || status === "running"}
      onClick={() => {
        if (value === "pdf" && pdfPlan) setPlanLimit({ kind: "feature", feature: "export.pdf", plan: billing.seed?.plan });
        else setFormat(value);
      }}
    >
      <span className="export-badge" aria-hidden={value === "backup"}>{value === "backup" ? "{ }" : value.toUpperCase()}</span>
      <strong>{title}{value === "pdf" && pdfPlan && <small className="paid-feature-plan">{pdfPlan}</small>}</strong>
      <span>{hint}</span>
      <span className="rm-choicecard-check export-format-check" aria-hidden="true">
        {format === value && <Icon name="check" size={12} />}
      </span>
    </button>
  );

  const statusLabel = status === "running" ? t(`export.${stageLabel}`)
    : status === "done" ? t("export.done") : t("export.failed");
  const close = () => {
    activeExport.current?.abort();
    onClose();
  };

  return (
    <Dialog
      title={t("export.title")}
      description={t("export.intro")}
      className={format === "png" && status === "idle" ? "export-sheet export-sheet-png" : "export-sheet"}
      size="md"
      onClose={close}
    >
      <section className="dialog-stack export-dialog">

        <section className="export-section">
          <h3>{t("export.formatTitle")}</h3>
          <div className="export-choices" role="radiogroup" onKeyDown={navigateChoices} aria-label={t("export.formatTitle")}>
            {formatOption("png", t("export.format.png"), t("export.format.pngHint"), canExport)}
            {formatOption("pdf", t("export.format.pdf"), t("export.format.pdfHint"), canExport)}
            {canBackup &&
              formatOption(
                "backup",
                t("export.format.backup"),
                t("export.format.backupHint"),
                canBackup,
              )}
          </div>
        </section>

        {format === "backup" ? <p className="export-note export-backup-note">{t("export.backupWholeBoard")}</p> : (
        <section className="export-section">
          <h3>
            {t("export.scopeTitle")}
          </h3>
          <div className="export-choices export-scopes" role="radiogroup" onKeyDown={navigateChoices} aria-label={t("export.scopeTitle")}>
            {scopeOption(
              "selection",
              t("export.scope.selection"),
              selectedIds.length
                ? count("selected", selectedIds.length)
                : t("export.scope.selectionEmpty"),
              selectedIds.length === 0,
              effectiveScope === "selection",
            )}
            {scopeOption(
              "frame",
              t("export.scope.frame"),
              frame
                ? frame.title ? t("export.scope.frameTitle", { title: frame.title }) : t("export.scope.frameHint")
                : t("export.scope.frameEmpty"),
              !frame,
              effectiveScope === "frame",
            )}
            {scopeOption(
              "board",
              t("export.scope.board"),
              count("objects", widgets.length),
              false,
              effectiveScope === "board",
            )}
          </div>
          {effectiveScope && effectiveScope !== "board" && (
            <p className="muted export-note">{count("objects", objectCount)}</p>
          )}
          <Checkbox
            className="export-comments"
            label={t("export.includeComments")}
            hint={t("export.commentsHint")}
            checked={includeComments}
            onChange={(event) => setIncludeComments(event.target.checked)}
          />
        </section>
        )}

        {status !== "idle" && (
          <div className={`export-status ${status}`} aria-live="polite">
            <div className="export-status-caption">
              <span>{statusLabel}</span>
              {status === "running" && <span>{t("export.unchanged")}</span>}
            </div>
            {status === "running" && (
              <>
                <progress className="rm-visually-hidden" aria-label={statusLabel} />
                <div className="export-progress" aria-hidden="true" />
              </>
            )}
          </div>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {backupTooLarge && format === "backup" && (
          <div className="export-warning" role="alert">
            <span>{t("export.backupTooLarge")}</span>
            <Button
              size="compact"
              onClick={() => void run({ withoutImages: true })}
              disabled={status === "running"}
            >
              {t("export.backupWithoutImages")}
            </Button>
          </div>
        )}
        {imageWarning > 0 && (
          <p className="export-warning" role="status">
            {t("export.imagesFailed", { count: count("images", imageWarning) })}
          </p>
        )}
        {planLimit && (
          <PlanNotice
            orgId={orgId}
            notice={planLimit}
            onSeePlans={onOpenBilling}
            onDismiss={() => setPlanLimit(null)}
          />
        )}

        <footer className="export-actions">
          <Button onClick={close}>
            {t("export.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void run()}
            disabled={!canRun}
          >
            {status === "error"
              ? t("export.retry")
              : status === "running"
                ? t("export.running")
                : t(`export.download.${format}`)}
          </Button>
        </footer>

        {canImport && (
          <details className="export-import" ref={importSection}>
            <summary>{t("export.importTitle")} <span aria-hidden="true">›</span></summary>
            <div className="export-restore-content">
            <p className="muted">{t("export.importHint")}</p>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void chooseFile(file);
              }}
            />
            {!pendingImport ? (
              <Button
                onClick={() => fileInput.current?.click()}
                disabled={importBusy || status === "running"}
              >
                {t("export.importChoose")}
              </Button>
            ) : (
              <div className="export-import-confirm">
                <p className="auth-error" role="alert">
                  {t("export.importConfirm", {
                    name: pendingImport.filename,
                    count: pendingImport.objects,
                  })}
                </p>
                <div className="export-actions">
                  <Button
                    onClick={() => setPendingImport(null)}
                    disabled={importBusy}
                  >
                    {t("export.cancel")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={confirmImport}
                    disabled={importBusy}>
                    {t("export.importReplace")}
                  </Button>
                </div>
              </div>
            )}
            {importError && (
              <p className="auth-error" role="alert">
                {importError}
              </p>
            )}
            </div>
          </details>
        )}
      </section>
    </Dialog>
  );
}

/** The same slug the server uses, so a downloaded file is recognizable. */
function filenameFor(title: string, extension: "png" | "pdf"): string {
  const slug =
    String(title || "room")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "room";
  return `${slug}.${extension}`;
}
