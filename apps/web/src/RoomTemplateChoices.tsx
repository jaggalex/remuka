import type { TemplateKey } from "@remo/model";
import { ChoiceCard, Segmented } from "@remo/ui";
import { useI18n, type TranslationKey } from "./i18n";
import { TEMPLATE_LABEL_KEY } from "./templateLabels";

type Choice = "empty" | TemplateKey;
const roadmap = "product-roadmap-basic";
const prefilled = "product-roadmap-basic-prefilled";
const cards = [
  { id: "empty", hint: "newBoard.start.emptyHint", grid: "", shapes: ["", "", ""] },
  { id: "user-story-map-basic", hint: "newBoard.storyHint", grid: "M14 36h152",
    shapes: ["M22 18h28v14H22zM58 18h28v14H58zM94 18h28v14H94zM130 18h28v14h-28z", "M22 42h28v14H22zM58 42h28v14H58zM94 42h28v14H94z", "M22 62h28v14H22zM94 62h28v14H94z"] },
  { id: roadmap, hint: "newBoard.roadmapHint", grid: "M52 14v72M90 14v72M128 14v72M14 38h152M14 62h152",
    shapes: ["M57 20h28v12H57z", "M95 44h28v12H95z", "M133 68h28v12h-28z"] },
  { id: "kanban-framework", hint: "newBoard.kanbanHint", grid: "",
    shapes: ["M22 22h40v12H22zM22 38h40v12H22z", "M70 22h40v12H70z", "M118 22h40v12h-40zM118 38h40v12h-40zM118 54h40v12h-40z"] },
] as const satisfies readonly { id: Choice; hint: TranslationKey; grid: string; shapes: readonly string[] }[];

export function RoomTemplateChoices({ value, onChange }: { value: Choice; onChange: (choice: Choice) => void }) {
  const { t } = useI18n();
  const selected = value === prefilled ? roadmap : value;
  return <fieldset className="new-board-start">
    <legend>{t("newBoard.template")}</legend>
    <ChoiceCard value={selected} name="new-board-template" label={t("newBoard.template")}
      className="new-board-templates" options={cards.map(card => ({
        value: card.id, hint: t(card.hint),
        title: <><svg viewBox="0 0 180 100" className="new-board-preview" aria-hidden="true">
          <path d={"M14 14h152v72H14z" + card.grid} fill="none" />
          {card.shapes.map((path, i) => path && <path key={i} className={"new-board-color-" + i} d={path} />)}
        </svg>{t(card.id === "empty" ? "newBoard.template.empty" : TEMPLATE_LABEL_KEY[card.id])}</>,
      }))} onChange={key => onChange(key as Choice)} />
    {selected === roadmap && <div className="new-board-example">
      <Segmented label={t("newBoard.layout")} value={value} options={[
        { value: roadmap, label: t("newBoard.blank") }, { value: prefilled, label: t("newBoard.start.example") },
      ]} onChange={key => onChange(key as Choice)} />
      <span>{t(value === prefilled ? "newBoard.start.exampleHint" : "newBoard.blankHint")}</span>
    </div>}
  </fieldset>;
}
