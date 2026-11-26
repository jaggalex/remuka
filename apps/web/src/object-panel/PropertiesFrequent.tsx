import { Button, IconButton, Select, Tooltip } from "@remo/ui";
import { elevationOf, FILL_LEVELS, type StickySize, type Widget } from "@remo/model";
import { paletteChoices } from "../commands";
import { useI18n } from "../i18n";
import { ELEVATION_LABEL_KEY, ELEVATION_LEVELS } from "../elevationMenu";
import type { StickyBarActions } from "./stickyTypes";

/**
 * The frequent half of the properties panel (ADR-266 §10a).
 *
 * The mockup puts what a person changes most at the top: the colour grid, then the text
 * size and alignment. The colours come from the same `paletteChoices` the menu and the
 * window read, so a swatch here cannot be a fifteenth colour. Nothing in this section
 * writes the document directly: every click is a `StickyBarActions` call, the same one
 * the bar makes.
 */
export function PropertiesFrequent({
  widget,
  actions,
  autoSize,
  disabled,
}: {
  widget: Widget;
  actions: StickyBarActions;
  /** What Auto currently uses, in board units (the bar's own number). */
  autoSize: number;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const text = widget.type === "text";
  const editable = ["sticky_note", "shape", "text"].includes(widget.type);
  if (!editable) return null;

  const current = (text ? widget.style?.color : widget.style?.fillColor)?.toLowerCase() ?? "";
  const choices = paletteChoices(text ? [600] : FILL_LEVELS);
  const explicit = widget.style?.fontSize;
  const align = widget.style?.textAlign ?? "center";
  const size = (widget.style?.stickySize ?? "M") as StickySize;

  return (
    <div className="properties-frequent">
      <section className="properties-group">
        <h3 className="properties-heading">
          {text ? t("properties.textColour") : t("properties.colour")}
        </h3>
        <div
          className={text ? "prop-swatches is-text" : "prop-swatches"}
          role="group"
          aria-label={text ? t("properties.textColour") : t("object.fill")}
        >
          {choices.map((choice) => {
            const on = choice.value.toLowerCase() === current;
            return (
              <Button
                key={choice.value}
                variant="ghost"
                size="compact"
                className={on ? "prop-swatch is-selected" : "prop-swatch"}
                style={{ background: choice.value }}
                aria-label={t(choice.label)}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => (text ? actions.setInk(choice.value) : actions.setColor(choice.value))}
              />
            );
          })}
        </div>
      </section>

      <section className="properties-group">
        <h3 className="properties-heading">{t("properties.text")}</h3>
        <div className="properties-row">
          <Button
            variant="ghost"
            size="compact"
            selected={explicit == null}
            disabled={disabled}
            onClick={() => actions.setFont(null)}
          >
            {t("sticky.auto")}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            disabled={disabled}
            onClick={() => actions.setFont(Math.max(6, (explicit ?? autoSize) - 1))}
          >
            A−
          </Button>
          <Button
            variant="ghost"
            size="compact"
            disabled={disabled}
            onClick={() => actions.setFont(Math.min(96, (explicit ?? autoSize) + 1))}
          >
            A+
          </Button>
          <span className="properties-row-gap" aria-hidden="true" />
          {(["left", "center", "right"] as const).map((value) => (
            <Tooltip
              key={value}
              label={t(
                value === "left"
                  ? "sticky.align.left"
                  : value === "right"
                    ? "sticky.align.right"
                    : "sticky.align.center",
              )}
            >
              <IconButton
                icon={value === "left" ? "align-left" : value === "right" ? "align-right" : "align-center"}
                size="compact"
                label={t(
                  value === "left"
                    ? "sticky.align.left"
                    : value === "right"
                      ? "sticky.align.right"
                      : "sticky.align.center",
                )}
                selected={align === value}
                disabled={disabled}
                onClick={() => actions.setAlign(value)}
              />
            </Tooltip>
          ))}
        </div>
        <span className="properties-note">
          {t("properties.textAutoHint", { size: explicit ?? autoSize })}
        </span>
      </section>

      {widget.type === "shape" && (
        <Select
          size="compact"
          label={t("inspector.shapeLift")}
          options={ELEVATION_LEVELS.map((level) => ({
            value: level ?? "none",
            label: t(ELEVATION_LABEL_KEY[level ?? "none"]!),
          }))}
          value={elevationOf(widget) ?? "none"}
          disabled={disabled || widget.locked}
          onChange={(event) => {
            const level = ELEVATION_LEVELS.find((value) => value === event.target.value);
            actions.setElevation(level ?? null);
          }}
        />
      )}
      {widget.type === "sticky_note" && (
        <section className="properties-group">
          <h3 className="properties-heading">{t("properties.stickySize")}</h3>
          <Select
            size="compact"
            aria-label={t("properties.stickySize")}
            options={["S", "M", "L"].map((value) => ({ value, label: value }))}
            value={size}
            disabled={disabled}
            onChange={(event) => actions.setSize(event.target.value as StickySize)}
          />
        </section>
      )}
    </div>
  );
}
