import type { TemplateKey } from "@remo/model";
import { useI18n } from "./i18n";
import { TEMPLATE_LABEL_KEY } from "./templateLabels";

/**
 * "Start from ready-made" on the team home (mockup App-Home).
 *
 * The four cards are the four templates the product actually has (ADR-158): a story map,
 * a roadmap, the same roadmap with an example, and a kanban room. The mockup's fourth card
 * is "a plan from a brief", which is the agent's job and not a template; the home offers
 * only what a click can deliver (ADR-265 §2, "consequences before action").
 *
 * A card opens the new-room dialog with the template already chosen — the same mechanism
 * the empty directory uses, not a second creation path.
 */
const CARDS: Array<{ template: TemplateKey; art: string; body: "storyMap" | "roadmap" | "roadmapPrefilled" | "kanban" }> = [
  { template: "user-story-map-basic", art: "story", body: "storyMap" },
  { template: "product-roadmap-basic", art: "roadmap", body: "roadmap" },
  { template: "product-roadmap-basic-prefilled", art: "process", body: "roadmapPrefilled" },
  { template: "kanban-framework", art: "kanban", body: "kanban" },
];

export function HomeTemplates({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: (template: TemplateKey) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="home-templates">
      {CARDS.map((card) => (
        <button
          key={card.template}
          type="button"
          className="home-template-card"
          disabled={disabled}
          onClick={() => onStart(card.template)}
        >
          <span className={`home-template-art is-${card.art}`} aria-hidden="true">
            <span className="home-art-sheet" />
            <span className="home-art-sheet" />
            <span className="home-art-sheet" />
          </span>
          <span className="home-template-text">
            <strong>{t(TEMPLATE_LABEL_KEY[card.template])}</strong>
            <span className="muted">{t(`home.template.${card.body}`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
