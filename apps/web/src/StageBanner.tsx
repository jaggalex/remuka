import { useEffect } from "react";
import { Banner } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * The stand's strip on every screen (ADR-261, `spec/stage.md` §5).
 *
 * It sits above the application shell rather than inside a screen, so a room, the
 * organisation home, help and the operator console cannot forget it. The same answer
 * from `/config` also installs `noindex` in the document: the edge nginx sends the
 * header, and this meta tag covers the HTML itself.
 */
export function StageBanner() {
  const { t, stage } = useI18n();

  useEffect(() => {
    if (!stage) return;
    document.body.dataset.stage = "1";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = "noindex, nofollow";
    return () => {
      delete document.body.dataset.stage;
      meta?.remove();
    };
  }, [stage]);

  if (!stage) return null;

  return (
    <div className="stage-banner">
      <Banner tone="warning">{t("stage.banner")}</Banner>
    </div>
  );
}
