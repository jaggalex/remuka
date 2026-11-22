import { useState } from "react";
import { Button, Input, Popover } from "@remo/ui";
import { useI18n } from "../i18n";
import { normalizeHref } from "../textFormatBar";

/**
 * The link window of the object bar (ADR-252 §5.3, §6, §9).
 *
 * One field, one address: Enter applies, Escape closes and the bar puts the caret back
 * into the text. The address is checked by the same rule the model stores with, so a
 * `javascript:` link cannot be entered here and then be silently dropped.
 */
export function LinkWindow({
  href,
  canApply,
  onApply,
  onRemove,
  onClose,
}: {
  /** The address under the selection, or null when there is none. */
  href: string | null;
  /** A range is selected, or the caret is on an existing link it could edit. */
  canApply: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(href ?? "");
  const check = value.trim() ? normalizeHref(value) : null;
  const error = check?.error ? t(`sticky.linkError.${check.error}` as "sticky.linkError.empty") : undefined;

  const apply = () => {
    if (!check?.href) return;
    onApply(check.href);
  };

  return (
    <span
      className="link-window"
      // The bar keeps the caret in the note by cancelling pointerdown (ADR-120); this
      // window is the one control on it that needs real focus, so it stops that there.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          apply();
        }
      }}
    >
      <Popover title={t("sticky.linkTitle")} width={300} onClose={onClose}>
        <Input
          label={t("sticky.linkAddress")}
          hint={canApply ? undefined : t("sticky.linkSelectText")}
          error={error}
          value={value}
          autoFocus
          inputMode="url"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="link-window-actions">
          <Button variant="primary" size="compact" disabled={!canApply || !check?.href} onClick={apply}>
            {t("sticky.linkApply")}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            icon="trash"
            disabled={!canApply || !href}
            onClick={onRemove}
          >
            {t("sticky.linkRemove")}
          </Button>
        </div>
      </Popover>
    </span>
  );
}
