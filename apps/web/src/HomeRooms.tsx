import { Button, Icon, Select } from "@remo/ui";
import type { BoardDirectoryPage, BoardTile } from "./boardDirectory";
import { RoomAppearance } from "./RoomAppearance";
import { RoomTileActions } from "./RoomTileActions";
import { formatAgo } from "./format";
import { useI18n, type Lang } from "./i18n";

/**
 * "Team rooms" on the home (mockup App-Home, ADR-197).
 *
 * The mockup shows a name, a picture and one line of life ("Ilya is here · changed 2
 * minutes ago"). The product has no presence on the home yet, so the line names the author
 * and when the room changed — the facts the directory actually carries. The directory
 * itself (search, sort, pages, trash, the tile menu) appears only when there is more than
 * one page or a filter, exactly as ADR-197 settled; one page of rooms is not a catalogue.
 */
export type HomeSort = "updated" | "created" | "name" | "author";

function pageNumbers(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const page of pages) {
    const previous = out[out.length - 1];
    if (typeof previous === "number" && page - previous > 1) out.push(null);
    out.push(page);
  }
  return out;
}

export function HomeRooms({
  data,
  status,
  error,
  directory,
  query,
  sort,
  dir,
  page,
  trash,
  totalPages,
  lang,
  canCreate,
  emojiBoard,
  boardTitle,
  onSort,
  onDir,
  onPage,
  onTrash,
  onBoards,
  onOpen,
  onRestore,
  onDuplicate,
  onDelete,
  onEmoji,
  onIcon,
  onNew,
  onRetry,
}: {
  data: BoardDirectoryPage | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  directory: boolean;
  query: string;
  sort: HomeSort;
  dir: "asc" | "desc";
  page: number;
  trash: boolean;
  totalPages: number;
  lang: Lang;
  canCreate: boolean;
  emojiBoard: string | null;
  boardTitle: (board: BoardTile) => string;
  onSort: (value: HomeSort) => void;
  onDir: () => void;
  onPage: (page: number) => void;
  onTrash: () => void;
  onBoards: () => void;
  onOpen: (board: BoardTile) => void;
  onRestore: (board: BoardTile) => void;
  onDuplicate: (board: BoardTile) => void;
  onDelete: (board: BoardTile) => void;
  onEmoji: (boardId: string | null) => void;
  onIcon: (board: BoardTile, icon: string) => void;
  onNew: () => void;
  onRetry: () => void;
}) {
  const { t, count } = useI18n();
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * (data?.pageSize ?? 24) + 1;
  const to = Math.min(page * (data?.pageSize ?? 24), total);

  return (
    <section className="home-rooms" aria-labelledby="home-rooms-title">
      <div className="home-rooms-head">
        <h2 id="home-rooms-title">{trash ? t("home.trash") : t("home.roomsTitle")}</h2>
        <span className="home-plan">{count("rooms", total)}</span>
        {!directory && (
          <Button size="compact" variant="ghost" onClick={onTrash}>
            {t("home.trash")}
          </Button>
        )}
      </div>

      {directory && (
        <div className="home-toolbar">
          <Select
            label={t("home.sort")}
            value={sort}
            options={[
              { value: "updated", label: t("home.updated") },
              { value: "created", label: t("home.created") },
              { value: "name", label: t("home.name") },
              { value: "author", label: t("home.author") },
            ]}
            onChange={(event) => onSort(event.currentTarget.value as HomeSort)}
          />
          <Button
            variant="secondary"
            aria-label={dir === "asc" ? t("home.asc") : t("home.desc")}
            title={dir === "asc" ? t("home.asc") : t("home.desc")}
            onClick={onDir}
          >
            {dir === "asc" ? "↑" : "↓"}
          </Button>
          <div className="home-views" role="group" aria-label={t("boards.title")}>
            <Button size="compact" variant="ghost" selected={!trash} onClick={onBoards}>
              {t("home.boards")}
            </Button>
            <Button size="compact" variant="ghost" selected={trash} onClick={onTrash}>
              {t("home.trash")}
            </Button>
          </div>
          <span className="home-count muted">
            {totalPages > 1 ? t("home.count", { from, to, total }) : ""}
          </span>
        </div>
      )}

      {error && (
        <div className="home-error" role="alert">
          <span>{error}</span>
          <Button size="compact" variant="secondary" onClick={onRetry}>
            {t("home.retry")}
          </Button>
        </div>
      )}

      {status === "loading" && !data ? (
        <p className="home-state">{t("home.loading")}</p>
      ) : data && data.boards.length === 0 ? (
        <section className="home-empty">
          <Icon name="boards" size={32} />
          <h3>
            {query.trim()
              ? t("home.noResults", { query: query.trim() })
              : trash
                ? t("home.emptyTrash")
                : t("home.empty")}
          </h3>
          {!query.trim() && !trash && (
            <Button variant="primary" icon="plus" onClick={onNew} disabled={!canCreate}>
              {t("boards.new")}
            </Button>
          )}
        </section>
      ) : data ? (
        <>
          <ul className="home-tiles">
            {data.boards.map((board) => (
              <li key={board.id} className="home-tile">
                <button
                  type="button"
                  className="home-tile-main"
                  onClick={() => onOpen(board)}
                  aria-label={`${t("home.open")}: ${boardTitle(board)}`}
                >
                  <span className="home-tile-thumb" aria-hidden="true">
                    {board.coverUpdatedAt && <img className="home-room-cover" loading="lazy" alt=""
                      src={`/api/boards/${encodeURIComponent(board.id)}/cover?v=${encodeURIComponent(board.coverUpdatedAt)}`} />}
                  </span>
                  <span className="home-tile-body">
                    <span className="home-tile-title">
                      {board.icon && <span className="home-tile-icon">{board.icon}</span>}
                      {boardTitle(board)}
                    </span>
                    <span className="home-tile-meta muted">
                      {board.createdByName
                        ? t("home.roomMeta", {
                            name: board.createdByName,
                            when: formatAgo(board.updatedAt, lang),
                          })
                        : t("home.roomMetaNoAuthor", { when: formatAgo(board.updatedAt, lang) })}
                    </span>
                  </span>
                </button>
                <RoomTileActions board={board} trash={trash} onRestore={() => onRestore(board)}
                  onAppearance={() => onEmoji(board.id)} onDuplicate={() => onDuplicate(board)}
                  onDelete={() => onDelete(board)} />
              </li>
            ))}
          </ul>

          {emojiBoard && <RoomAppearance boardId={emojiBoard} onClose={() => onEmoji(null)}
            onSaved={(icon) => {
              const board = data.boards.find((row) => row.id === emojiBoard);
              if (board) onIcon(board, icon);
            }} />}
          {totalPages > 1 && (
            <nav className="home-pages" aria-label={t("home.page", { page })}>
              <Button
                size="compact"
                variant="secondary"
                disabled={page <= 1}
                aria-label={t("home.previousPage")}
                onClick={() => onPage(Math.max(1, page - 1))}
              >
                ‹
              </Button>
              {pageNumbers(page, totalPages).map((number, index) =>
                number === null ? (
                  <span key={`gap-${index}`} className="home-page-gap" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <Button
                    key={number}
                    size="compact"
                    variant={number === page ? "primary" : "secondary"}
                    aria-current={number === page ? "page" : undefined}
                    aria-label={t("home.page", { page: number })}
                    onClick={() => onPage(number)}
                  >
                    {number}
                  </Button>
                ),
              )}
              <Button
                size="compact"
                variant="secondary"
                disabled={page >= totalPages}
                aria-label={t("home.nextPage")}
                onClick={() => onPage(Math.min(totalPages, page + 1))}
              >
                ›
              </Button>
            </nav>
          )}
        </>
      ) : null}
    </section>
  );
}
