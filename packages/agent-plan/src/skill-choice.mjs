const DIAGRAM_HINTS = /(diagram|flow|process|scheme|chart|диаграм|схем|процесс|блок)/i;
const CARD_HINTS = /(card|kanban|task|карточ|канбан|задач)/i;
const TIDY_HINTS =
  /(упорядоч|приберис|приберись|наведи\s+порядок|разложи|разложить|выровняй|tidy\s*up|tidy|arrange|line\s*up)/i;
const BRIEF_HINTS =
  /(us[-\s]?карт|user[-\s]?story|story[-\s]?map|карт[ауы]?\s+истори|создай\s+фрейм|сделай\s+фрейм|фрейм\s+с|создай\s+структур|собери\s+структур|swimlane|дорожк)/i;

/**
 * Pick a published skill for a task.
 *
 * The model does not choose freely: the catalog is already filtered by the caller and
 * the server validates the skill's requirements again before running it. With one
 * built-in skill this is a deterministic match, which is what makes it auditable; an
 * LLM router can replace it later without changing the contract.
 */
export function resolveSkill(skills, { slug = null, intent = "" } = {}) {
  const published = skills.filter((skill) => skill.state === "published");
  // An explicit slug is the caller's decision and always wins over a hint.
  if (slug) {
    return published.find((skill) => skill.slug === slug) ?? null;
  }
  // "Create a frame with ..." is a structure, even when the request also says
  // "cards": the story-map skill owns the frame, the cards skill owns conversion.
  if (BRIEF_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "brief-to-board") ?? null;
  }
  // "Tidy up", "приберись", "разложи" are an arrangement request, never a conversion:
  // the selected objects stay the same objects and only their coordinates change.
  if (TIDY_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "tidy-selection") ?? null;
  }
  if (CARD_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "cards") ?? null;
  }
  if (DIAGRAM_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "diagram") ?? null;
  }
  return published[0] ?? null;
}
