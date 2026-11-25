import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Button, CommandPalette, Icon } from "@remo/ui";
import type { CommandContext } from "./commands";
import {
  buildSearchRows,
  rankSearchRows,
  readRecentCommands,
  recentRows,
  rememberCommand,
  suggestionRows,
  type SearchRow,
} from "./commandSearch";
import {
  closeCommandSearch,
  commandSearchOpener,
  useCommandSearchOpen,
} from "./commandSearchStore";
import { useChromeSurface } from "./chromeSurfaces";
import { useI18n } from "./i18n";

/**
 * The command search (⌘K), ADR-266 §1.2.
 *
 * A dialog with a combobox and a listbox, not a menu: the list is the registry and the
 * keyboard is the main way through it. Focus goes back to whatever held it before the
 * dialog opened — a canvas, a button or the bottom panel. The shape follows the
 * `cmdk` state of the room-header artboard: a paper sheet, an ink outline, a hard
 * shadow, the search row with an Esc chip, then rows of "title + where + key".
 */
export function CommandSearch({
  objectContext,
  canAskAgents,
  onAskAgent,
}: {
  /** The selection the object commands act on; the same context the menus use. */
  objectContext: CommandContext;
  /** Agents are allowed in this room, so the last line may offer one (ADR-266 §1.2). */
  canAskAgents: boolean;
  /** Hand the typed text to the agent dialog; the search itself runs nothing. */
  onAskAgent: (text: string) => void;
}) {
  const open = useCommandSearchOpen();
  if (!open) return null;
  return (
    <CommandSearchDialog
      objectContext={objectContext}
      canAskAgents={canAskAgents}
      onAskAgent={onAskAgent}
    />
  );
}

/** A registry row plus the last line, which is not a command (it opens the agent). */
interface Entry extends SearchRow {
  agent?: boolean;
}

interface Entries {
  rows: Entry[];
  /** Nothing matched the query; the agent line may still be there. */
  empty: boolean;
}

function CommandSearchDialog({
  objectContext,
  canAskAgents,
  onAskAgent,
}: {
  objectContext: CommandContext;
  canAskAgents: boolean;
  onAskAgent: (text: string) => void;
}) {
  const { t } = useI18n();
  const chrome = useChromeSurface();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>(() => readRecentCommands());

  const registryRows = useMemo(
    () => buildSearchRows(objectContext, { can: chrome.can, run: chrome.run }),
    [objectContext, chrome],
  );

  const entries = useMemo<Entries>(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      const shownRecent = recentRows(registryRows, recent);
      const suggestions = suggestionRows(registryRows, {
        hasSelection: objectContext.ids.length > 0,
        exclude: shownRecent.map((row) => row.id),
      });
      return { rows: [...shownRecent, ...suggestions], empty: false };
    }
    const matched: Entry[] = rankSearchRows(trimmed, registryRows, (row) => ({
      title: t(row.title),
      synonyms: row.synonyms,
    }));
    const empty = matched.length === 0;
    if (canAskAgents) {
      matched.push({
        id: "search.askAgent",
        title: "search.askAgent",
        where: "roomAgent.menu",
        synonyms: { ru: [], en: [] },
        scope: "chrome",
        intent: "agent",
        agent: true,
        run: () => onAskAgent(trimmed),
      });
    }
    return { rows: matched, empty };
  }, [canAskAgents, objectContext.ids.length, onAskAgent, query, recent, registryRows, t]);

  useEffect(() => setActive(-1), [query]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`command-search-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (entry: Entry | undefined) => {
    if (!entry || entry.reason) return;
    if (!entry.agent) setRecent(rememberCommand(entry.id));
    closeCommandSearch();
    entry.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = entries.rows;
    const last = rows.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current >= last ? Math.max(0, last) : current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current <= 0 ? last : current - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(rows.length ? 0 : -1);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active >= 0 ? rows[active] : rows[0]);
    }
  };

  const selected = active >= 0 ? `command-search-${active}` : undefined;
  const trimmed = query.trim();

  return (
    <CommandPalette
      label={t("search.title")}
      onClose={closeCommandSearch}
      returnFocusTo={commandSearchOpener()}
    >
      <div className="command-search-body" onKeyDown={onKeyDown}>
        <label className="command-search-field">
          <Icon name="search" size={18} />
          <span className="rm-visually-hidden">{t("search.input")}</span>
          <input
            className="command-search-input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-search-list"
            aria-autocomplete="list"
            aria-activedescendant={selected}
            aria-label={t("search.input")}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button
            variant="secondary"
            size="compact"
            className="command-search-esc"
            aria-label={t("search.close")}
            onClick={closeCommandSearch}
          >
            Esc
          </Button>
        </label>
        <div
          className="command-search-list"
          id="command-search-list"
          role="listbox"
          aria-label={t("search.title")}
        >
          {entries.rows.map((entry, index) => {
            const title = t(entry.title, entry.agent ? { query: trimmed } : undefined);
            return (
              <div
                key={`${entry.id}-${index}`}
                id={`command-search-${index}`}
                role="option"
                aria-selected={active === index}
                aria-disabled={entry.reason ? true : undefined}
                className={[
                  "command-search-row",
                  active === index ? "is-active" : "",
                  entry.reason ? "is-unavailable" : "",
                  entry.danger ? "is-danger" : "",
                  entry.agent ? "is-agent" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(entry)}
              >
                <span className="command-search-text">
                  <strong>{title}</strong>
                  <span className="command-search-where">
                    {entry.reason ? t(entry.reason) : t(entry.where)}
                  </span>
                </span>
                {entry.shortcut && (
                  <span className="command-search-key" aria-hidden="true">
                    {entry.shortcut}
                  </span>
                )}
              </div>
            );
          })}
          {entries.empty && (
            <p className="command-search-empty" role="presentation">
              {t("search.empty")}
            </p>
          )}
        </div>
      </div>
    </CommandPalette>
  );
}
