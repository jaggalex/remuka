import { Button, IconButton, Tooltip } from "@remo/ui";
import { useI18n } from "../i18n";
import type { BarBlock } from "../textFormatBar";

/**
 * The line-format row of the object bar (ADR-252 §6).
 *
 * Buttons only: what a block is and which one is pressed comes from the caller, and what
 * pressing it means (the editor's selection or the whole object) is decided there too.
 * Every control is a design-system Button with `aria-pressed`; the shortcut lives in the
 * tooltip, so the bar and the keyboard teach the same keys (ADR-252 §9).
 */
export function TextFormatBar({
  block,
  code,
  link,
  editing,
  onBlock,
  onCode,
  onLink,
}: {
  /** The block common to the lines the bar is about, or null when they differ. */
  block: BarBlock | null;
  /** The selection (or the whole object) is inline code. */
  code: boolean;
  /** A link is under the selection; only read while editing. */
  link: boolean;
  editing: boolean;
  onBlock: (block: BarBlock) => void;
  onCode: () => void;
  onLink: () => void;
}) {
  const { t } = useI18n();

  const items: Array<{
    block: BarBlock;
    label: string;
    shortcut: string[];
    keyshortcuts: string;
    icon?: "list-bullet" | "list-ordered" | "list-check";
    text?: string;
  }> = [
    {
      block: "h1",
      label: t("sticky.heading1"),
      shortcut: ["⌘", "⌥", "1"],
      keyshortcuts: "Meta+Alt+1",
      text: "H1",
    },
    {
      block: "h2",
      label: t("sticky.heading2"),
      shortcut: ["⌘", "⌥", "2"],
      keyshortcuts: "Meta+Alt+2",
      text: "H2",
    },
    {
      block: "bullet",
      label: t("sticky.bulletList"),
      shortcut: ["⌘", "⇧", "8"],
      keyshortcuts: "Meta+Shift+8",
      icon: "list-bullet",
    },
    {
      block: "ordered",
      label: t("sticky.numberedList"),
      shortcut: ["⌘", "⇧", "7"],
      keyshortcuts: "Meta+Shift+7",
      icon: "list-ordered",
    },
    {
      block: "check",
      label: t("sticky.checklist"),
      shortcut: ["⌘", "⇧", "9"],
      keyshortcuts: "Meta+Shift+9",
      icon: "list-check",
    },
  ];

  return (
    <div className="sb-group sb-format" role="group" aria-label={t("sticky.format")}>
      {items.map((item) =>
        item.icon ? (
          <Tooltip key={item.block} label={item.label} shortcut={item.shortcut}>
            <IconButton
              icon={item.icon}
              size="compact"
              label={item.label}
              aria-keyshortcuts={item.keyshortcuts}
              selected={block === item.block}
              onClick={() => onBlock(item.block)}
            />
          </Tooltip>
        ) : (
          <Tooltip key={item.block} label={item.label} shortcut={item.shortcut}>
            <Button
              variant="ghost"
              size="compact"
              className="sb-block-mark"
              aria-label={item.label}
              aria-keyshortcuts={item.keyshortcuts}
              selected={block === item.block}
              onClick={() => onBlock(item.block)}
            >
              {item.text}
            </Button>
          </Tooltip>
        ),
      )}
      <Tooltip label={t("sticky.inlineCode")} shortcut={["⌘", "E"]}>
        <IconButton
          icon="code"
          size="compact"
          label={t("sticky.inlineCode")}
          aria-keyshortcuts="Meta+E"
          selected={code}
          onClick={onCode}
        />
      </Tooltip>
      <Tooltip
        label={editing ? t("sticky.link") : t("sticky.linkNeedsEdit")}
        shortcut={editing ? ["⌘", "K"] : undefined}
      >
        {/* A disabled button still explains itself: the tooltip wraps the control, not
            the other way round. Outside the editor there is no selection to link. */}
        <IconButton
          icon="link"
          size="compact"
          label={editing ? t("sticky.link") : t("sticky.linkNeedsEdit")}
          aria-keyshortcuts={editing ? "Meta+K" : undefined}
          selected={editing && link}
          disabled={!editing}
          onClick={onLink}
        />
      </Tooltip>
    </div>
  );
}
