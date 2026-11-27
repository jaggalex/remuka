import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, Select, Textarea } from "@remo/ui";
import { call, ApiError } from "../apiCall";
import { type HintLocale, type WordVariant } from "../hintCatalog";
import { useI18n, type TranslationKey } from "../i18n";

interface Slot {
  id: string;
  screen: string;
  description: Record<HintLocale, string>;
  fields: string[];
  maxLength: Record<string, number>;
  placeholders: string[];
  defaults: Record<HintLocale, WordVariant[]>;
}
interface Revision { version: number; variants: WordVariant[] }
interface SlotState { draft: Revision | null; published: Revision; history: Revision[] }
interface Count { slot: string; variant: string; shown: number; acted: number }
const endpoint = "/operator/words";
const problems: Record<string, TranslationKey> = {
  html: "words.error.html", link: "words.error.link", placeholder: "words.error.placeholder",
  emoji: "words.error.emoji", voice: "words.error.voice", bold: "words.error.bold",
  length: "words.error.length", enabled: "words.error.enabled", reason: "words.error.reason",
  conflict: "words.error.conflict",
};
function previewWords(value: string, lang: HintLocale) {
  const examples: Record<string, string> = {
    "{name}": lang === "ru" ? "Аня" : "Alex",
    "{room}": lang === "ru" ? "Дизайн" : "Design",
    "{others}": " + 2",
  };
  return value.split(/(\{(?:name|room|others)\})/g).map((part, index) =>
    Object.hasOwn(examples, part) ? <mark key={index} title={part}>{examples[part]}</mark> : part);
}

export function OperatorWords({ onNeedCode }: { onNeedCode: (challenge: string, retry: () => void) => void }) {
  const { t, lang } = useI18n();
  const translate = useRef(t);
  translate.current = t;
  const [slots, setSlots] = useState<Slot[]>([]);
  const [id, setId] = useState("");
  const [locale, setLocale] = useState<HintLocale>(lang);
  const [state, setState] = useState<SlotState | null>(null);
  const [rows, setRows] = useState<WordVariant[]>([]);
  const [counts, setCounts] = useState<Count[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const slot = slots.find(s => s.id === id);
  const query = "?" + new URLSearchParams({ slot: id, lang: locale });
  useEffect(() => {
    let active = true;
    void call<{ slots: Slot[]; counts: Count[]; metricsAvailable: boolean }>(endpoint).then(result => {
      if (!active) return;
      setSlots(result.slots);
      setId(result.slots[0]?.id ?? "");
      setCounts(result.metricsAvailable ? result.counts : null);
    }).catch(() => { if (active) setError(translate.current("words.error.load")); });
    return () => { active = false; };
  }, []);
  const apply = useCallback((result: SlotState) => {
    setState(result);
    setRows(result.draft?.variants ?? result.published.variants);
    setDirty(false);
  }, []);
  useEffect(() => {
    if (!id) return;
    let current = true;
    setState(null);
    setReason(""); setError(""); setNotice("");
    void call<SlotState>(endpoint + query).then(result => { if (current) apply(result); })
      .catch(() => { if (current) setError(translate.current("words.error.load")); });
    return () => { current = false; };
  }, [id, query, apply]);
  const save = async (action: "draft" | "publish" | "rollback") => {
    if (!state || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await call<{ warnings: { field: string }[] }>(endpoint + "/" + action + query, {
        method: "POST", body: { expected: state.draft?.version ?? state.published.version, reason, variants: rows },
      });
      apply(await call<SlotState>(endpoint + query));
      setReason("");
      setNotice(result.warnings.length ? t("words.warning") + " · " + result.warnings.map(w => w.field).join(", ") : t("words.saved"));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "MFA_REQUIRED") {
        onNeedCode(String(failure.details.challenge ?? ""), () => void save(action));
      } else if (failure instanceof ApiError) {
        const field = String(failure.details.field ?? "");
        setError([field, t(problems[failure.code] ?? "words.error.load")].filter(Boolean).join(" · "));
      } else setError(t("words.error.load"));
    } finally { setBusy(false); }
  };
  const edit = (key: string, update: Partial<WordVariant>) => {
    setRows(previous => previous.map(v => v.key === key ? { ...v, ...update } : v));
    setDirty(true); setNotice("");
  };
  return <section className="operator-section operator-words">
    <h2>{t("words.title")}</h2>
    <Select label={t("words.place")} value={id} disabled={busy}
      options={slots.map(s => ({ value: s.id, label: s.screen + " · " + s.description[lang] }))}
      onChange={event => setId(event.currentTarget.value)} />
    <Select label={t("words.lang")} value={locale} disabled={busy}
      options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]}
      onChange={e => setLocale(e.currentTarget.value as HintLocale)} />
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {slot && state && <>
      <p>{slot.description[lang]} · {t("words.version", { n: state.published.version })}</p>
      {slot.placeholders.length > 0 && <p>{t("words.tokens")} {slot.placeholders.map(p => <code key={p}>{" {" + p + "} "}</code>)}</p>}
      {rows.map(v => {
        const count = counts?.find(c => c.slot === id && c.variant === v.key);
        const preview = (v.fields.title ?? "").split("**");
        return <fieldset key={v.key}><legend>{v.key}</legend>
          <Checkbox label={t("words.enabled")} checked={v.enabled} onChange={e => edit(v.key, { enabled: e.currentTarget.checked })} />
          {slot.fields.map(field => <Textarea key={field}
            label={t(field === "title" ? "words.heading" : "words.body")}
            hint={Array.from(v.fields[field] ?? "").length + " / " + slot.maxLength[field]}
            value={v.fields[field] ?? ""} onChange={e => edit(v.key, { fields: { ...v.fields, [field]: e.currentTarget.value } })} />)}
          <div className={id.startsWith("news.") ? "home-news-card" : id === "room.empty" ? "empty-heading" : id === "home.quiet" ? "home-lead" : "operator-note"} aria-label={t("words.preview")}>
            {v.fields.title && <h3>{previewWords(preview[0] ?? "", locale)} {preview[1] && <strong>{previewWords(preview[1], locale)}</strong>}</h3>}
            <p>{previewWords(v.fields.body ?? "", locale)}</p>
          </div>
          <p>{counts ? t("words.stats", { shown: count?.shown ?? 0, acted: count?.acted ?? 0,
            rate: count?.shown ? Math.round(100 * count.acted / count.shown) : 0 }) : t("words.noStats")}</p>
        </fieldset>;
      })}
      <Button disabled={busy || !dirty} onClick={() => void save("draft")}>{t("words.saveDraft")}</Button>
      <Input label={t("words.reason")} value={reason} onChange={e => setReason(e.currentTarget.value)} maxLength={500} />
      <Button variant="primary" disabled={busy || dirty || !state.draft || !reason.trim()} onClick={() => void save("publish")}>{t("words.publish")}</Button>
      <Button disabled={busy || dirty || state.history.length < 2 || !reason.trim()} onClick={() => void save("rollback")}>{t("words.rollback")}</Button>
    </>}
  </section>;
}
