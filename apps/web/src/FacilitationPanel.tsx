import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton, Tabs } from "@remo/ui";
import { useI18n } from "./i18n";
import "./styles/facilitation-panel.css";

export type FacilitationTab = "timer" | "vote" | "follow" | "show";
const tabs = ["timer", "vote", "follow", "show"] as const;
const titles = { timer: "facilitation.timer.title", vote: "facilitation.vote.title", follow: "follow.title", show: "presentation.title" } as const;
const destination = createContext<HTMLElement | null>(null);

/** The canvas retains the controllers, selection and live presence. Only one tab owns the panel body. */
export function FacilitationPanel({ tab, onChange, children }: {
  tab: FacilitationTab | null; onChange: (tab: FacilitationTab | null) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const open = tab !== null;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);
  return <destination.Provider value={body}>
    {children}
    {tab && <aside ref={panel} className="facilitation-panel" role="dialog" aria-label={t(titles[tab])}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); onChange(null); }
      }}>
      <header><h2>{t("facilitation.menu")}</h2>
        <IconButton icon="close" label={t("ds.close")} onClick={() => onChange(null)} /></header>
      <Tabs label={t("facilitation.menu")} value={tab}
        tabs={tabs.map(id => ({ id, label: t(`facilitation.tab.${id}`) }))}
        onChange={id => {
          onChange(id as FacilitationTab);
          requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
        }} />
      <div ref={setBody} className="facilitation-body" role="tabpanel" aria-label={t(titles[tab])} />
    </aside>}
  </destination.Provider>;
}

export function FacilitationBody({ title, description, help, children }: {
  title?: string; description?: string; help?: ReactNode; children: ReactNode;
}) {
  const body = useContext(destination);
  return body && createPortal(<>{title && <div className="facilitation-heading"><h3>{title}</h3>{help}</div>}{description && <p>{description}</p>}{children}</>, body);
}
