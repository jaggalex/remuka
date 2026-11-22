import { useState } from "react";
import { Banner } from "@remo/ui";
import { useI18n } from "./i18n";
import {
  dismissMoveBanner,
  moveBannerDismissed,
  moveDate,
  moveHost,
  shouldShowMove,
} from "./moveBanner";

/**
 * The move notice, on the home and above the room (`spec/rebrand-fixes.md` §1).
 *
 * It is the same `Banner` the mail reminders use, so it appears in the one notification
 * language the product has: a warning strip above the work, closed with the same control,
 * remembered for the browser session. `/config` supplies the address and the day; nothing
 * is invented here.
 */
export function MoveNotice() {
  const { t, lang, move } = useI18n();
  const [hidden, setHidden] = useState(moveBannerDismissed);
  if (hidden || !shouldShowMove(move)) return null;

  return (
    <div className="move-banner">
      <Banner
        tone="warning"
        onClose={() => {
          dismissMoveBanner();
          setHidden(true);
        }}
      >
        {t("move.body", {
          host: moveHost(move.to),
          date: moveDate(move.at, lang),
        })}
      </Banner>
    </div>
  );
}
