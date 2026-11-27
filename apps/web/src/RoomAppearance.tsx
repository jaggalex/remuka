import { useEffect, useState } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { api } from "./api";
import { setBoardIcon } from "./boardDirectory";
import { useI18n } from "./i18n";

type Entry = { unicode: string; label: string; tags?: string[]; group?: number; skins?: Entry[] };
const batch = 48;

/** Load only the active language, and only while someone is choosing an icon. */
async function dictionary(lang: string): Promise<Entry[]> {
  const { default: rows } = lang === "ru"
    ? await import("emojibase-data/ru/compact.json")
    : await import("emojibase-data/en/compact.json");
  return (rows as Entry[]).filter((row) => row.group != null)
    .flatMap((row) => [row, ...(row.skins ?? [])]);
}

export function RoomAppearance({ boardId, onClose, onSaved }: {
  boardId: string; onClose: () => void; onSaved: (icon: string) => void;
}) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [icon, setIcon] = useState("");
  const [editable, setEditable] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(batch);
  useEffect(() => {
    let current = true;
    setEditable(false);
    setCover(null);
    setError(false);
    setEntries([]);
    Promise.all([api.access(boardId), dictionary(lang)]).then(([result, options]) => {
      if (!current) return;
      setIcon(result.board?.icon ?? "");
      setCover(result.board?.coverUpdatedAt ?? null);
      setEditable(result.access.capabilities.includes("board.edit"));
      setEntries(options);
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [boardId, lang, attempt]);

  async function choose(value: string) {
    if (!editable || pending) return;
    setPending(true);
    setError(false);
    try {
      const result = await setBoardIcon(boardId, value);
      onSaved(result.board.icon);
      onClose();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = entries.filter((row) => !needle || row.unicode === needle ||
    row.label.toLowerCase().includes(needle) || row.tags?.some((tag) => tag.includes(needle)));
  return (
    <Dialog title={t("home.appearance")} size="sm" onClose={onClose}>
      {cover && <img className="appearance-preview" alt={t("home.coverPreview")}
        src={`/api/boards/${encodeURIComponent(boardId)}/cover?v=${encodeURIComponent(cover)}`} />}
      {error && <div role="alert">{t("home.appearanceFailed")} <Button variant="ghost"
        onClick={() => setAttempt(attempt + 1)}>{t("home.retry")}</Button></div>}
      {!entries.length && !error && <p role="status">{t("home.appearanceLoading")}</p>}
      {entries.length > 0 && !editable && <p>{icon} {t("iam.readOnly")}</p>}
      {editable && <>
        <Input label={t("home.emoji")} type="search" value={query}
          onChange={(event) => { setQuery(event.target.value); setLimit(batch); }} />
        <div className="room-emoji-results">
          <div className="home-emoji-grid">
            {matches.slice(0, limit).map((row) => (
              <Button key={row.unicode} variant="ghost" size="compact" selected={icon === row.unicode}
                title={row.label} aria-label={row.label} disabled={pending}
                onClick={() => void choose(row.unicode)}>{row.unicode}</Button>
            ))}
          </div>
          {matches.length === 0 && <p>{t("home.emojiEmpty")}</p>}
          {matches.length > limit && <Button variant="ghost"
            onClick={() => setLimit(limit + batch)}>{t("home.emojiMore")}</Button>}
        </div>
        {icon && <Button variant="ghost" disabled={pending} onClick={() => void choose("")}>
          {t("home.noEmoji")}</Button>}
      </>}
    </Dialog>
  );
}
