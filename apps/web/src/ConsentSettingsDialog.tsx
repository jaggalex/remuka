/**
 * «Настройки cookie»: one switch per category that is actually a question (§6.2, §6.3).
 *
 * A switch exists only where a choice exists. `necessary` is on because the service cannot
 * run without it, and `preferences` is on for the same reason — a language and a theme the
 * person chose are necessary for the requested service (§2, §6) — so both are stated, not
 * offered. In the `none` zone nothing is optional at all, so the screen explains that the
 * installation uses only necessary cookies and shows the registry without switches.
 *
 * The screen is a form with «Сохранить», so the rows that can move are checkboxes, not
 * switches: an `@remo/ui` `Switch` applies at once and must never sit next to a save
 * button. The body is exported separately from the dialog so its markup — a stated row
 * without an input in particular — is tested without a browser.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Dialog, Link } from "@remo/ui";
import type { ConsentCategory } from "@remo/consent";
import { categoryRows, type ConsentCategoryRow, type ConsentView } from "./consentClient";
import { CATEGORY_HINT_KEYS, CATEGORY_KEYS, lifetimeKey } from "./consentText";
import { useI18n } from "./i18n";

/** One row as the presentational list draws it: words already resolved. */
export interface ConsentCategoryView {
  readonly category: ConsentCategory;
  readonly title: string;
  readonly hint: string;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly lockLabel: string | null;
  /** «12 записей», already counted and translated by the dialog. */
  readonly countLabel?: string;
  readonly records: readonly { name: string; purpose: string; lifetime: string }[];
}

/**
 * The list of categories and their registry records, without a dialog around it.
 *
 * A locked row has no input: a disabled checkbox is still a switch that pretends it could
 * move, and the decision that a category is necessary is not the person's to change here.
 *
 * The records of a category are folded into a native `<details>`: a person reads two
 * sentences and expands the register only when they want it. Printing twenty keys at once
 * is a wall nobody reads, and the policy page keeps the full table anyway (§6.3).
 */
export function ConsentCategoryList({
  rows,
  onToggle,
}: {
  rows: readonly ConsentCategoryView[];
  onToggle?: (category: ConsentCategory, enabled: boolean) => void;
}) {
  const records = (row: ConsentCategoryView) => (
    <ul className="consent-records">
      {row.records.map((record) => (
        <li key={record.name}>
          <code>{record.name}</code>
          <span className="consent-record-purpose">{record.purpose}</span>
          <span className="consent-record-lifetime">{record.lifetime}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <ul className="consent-categories">
      {rows.map((row) => (
        <li className="consent-category" key={row.category}>
          {row.locked ? (
            <details className="consent-category-details">
              <summary className="consent-category-summary">
                <span className="consent-category-title">{row.title}</span>
                <span className="consent-category-hint">{row.hint}</span>
                <span className="consent-category-meta">
                  {row.lockLabel && <span className="consent-category-lock">{row.lockLabel}</span>}
                  {row.countLabel && (
                    <span className="consent-category-count">{row.countLabel}</span>
                  )}
                </span>
              </summary>
              {records(row)}
            </details>
          ) : (
            <>
              <Checkbox
                checked={row.enabled}
                label={row.title}
                hint={row.hint}
                onChange={(event) => onToggle?.(row.category, event.currentTarget.checked)}
              />
              <details className="consent-category-details">
                <summary className="consent-category-summary">
                  <span className="consent-category-count">{row.countLabel}</span>
                </summary>
                {records(row)}
              </details>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The dialog; the provider owns when it is open and what saving means. */
export function ConsentSettingsDialog({
  open,
  view,
  policyHref,
  personalDataHref = null,
  busy = false,
  error = null,
  onSave,
  onClose,
}: {
  open: boolean;
  view: ConsentView;
  policyHref: string;
  /** The separate personal-data consent document, when the operator set one (§3). */
  personalDataHref?: string | null;
  busy?: boolean;
  error?: string | null;
  onSave: (choices: Partial<Record<ConsentCategory, boolean>>) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  // The draft starts from the stored choice and is dropped on every close: a cancelled
  // screen must not leave the next visit pre-ticked with a choice never saved.
  const [draft, setDraft] = useState<Partial<Record<ConsentCategory, boolean>>>({});
  useEffect(() => {
    if (open) setDraft({});
  }, [open]);

  const base = useMemo(() => categoryRows(view), [view]);
  const rows = useMemo<ConsentCategoryView[]>(
    () =>
      base.map((row: ConsentCategoryRow) => ({
        category: row.category,
        title: t(CATEGORY_KEYS[row.category]),
        hint: t(CATEGORY_HINT_KEYS[row.category]),
        enabled: draft[row.category] ?? row.enabled,
        locked: row.locked,
        lockLabel:
          row.lock === "gpc"
            ? t("consent.settings.gpc")
            : row.lock === "policy"
              ? t("consent.settings.none")
              : row.lock
                ? t("consent.settings.always")
                : null,
        countLabel: t("consent.settings.records", { count: row.entries.length }),
        records: row.entries.map((entry) => {
          const key = lifetimeKey(entry.lifetime);
          return {
            name: entry.name,
            purpose: entry.purpose[lang],
            lifetime: key ? t(key) : entry.lifetime,
          };
        }),
      })),
    [base, draft, lang, t],
  );

  if (!open) return null;

  // Nothing to save means no save button: in the `eu` and `ru` zones of this release the
  // registry has no optional category, and in `none` there is no question at all (§3, §6).
  const changeable = rows.some((row) => !row.locked);

  const save = () => {
    const choices: Partial<Record<ConsentCategory, boolean>> = {};
    for (const row of rows) {
      if (!row.locked && (row.category === "analytics" || row.category === "marketing")) {
        choices[row.category] = row.enabled;
      }
    }
    onSave(choices);
  };

  return (
    <Dialog
      title={t("consent.settings.title")}
      description={t("consent.settings.intro")}
      size="md"
      onClose={onClose}
      footer={
        <>
          <span className="rm-foot-start">
            {policyHref && <Link href={policyHref}>{t("consent.settings.policy")}</Link>}{" "}
            {personalDataHref && (
              <Link href={personalDataHref} rel="noreferrer">
                {t("consent.settings.personalData")}
              </Link>
            )}
          </span>
          {changeable ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                {t("consent.settings.cancel")}
              </Button>
              <Button variant="primary" loading={busy} onClick={save}>
                {t("consent.settings.save")}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onClose}>
              {t("consent.close")}
            </Button>
          )}
        </>
      }
    >
      {view.zone === "none" && <p className="consent-note">{t("consent.settings.noneOnly")}</p>}
      {view.zone !== "none" && !changeable && (
        <p className="consent-note">{t("consent.settings.noChoice")}</p>
      )}
      {error && (
        <p className="consent-error" role="alert">
          {error}
        </p>
      )}
      <ConsentCategoryList
        rows={rows}
        onToggle={(category, enabled) =>
          setDraft((current) => ({ ...current, [category]: enabled }))
        }
      />
    </Dialog>
  );
}
