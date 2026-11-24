# Product visual baselines

PNG evidence for the screens and canvas states the product promises. They are Linux renders
from Chromium in the Playwright image, and `pnpm e2e:visual` compares every screen against
them (ADR-222). A deliberate visual change regenerates them in the same pull request:

```bash
pnpm test:db:up
pnpm baselines
```

| File | What it shows |
|---|---|
| `connector-straight.png` | A straight connector between two notes |
| `connector-elbow.png` | An elbow with different endpoint heights |
| `connector-curved.png` | A curved connector with different endpoint heights |
| `connectors.png` | The three routings on one canvas (overview) |
| `board.png` | The board at 1440×900 with the inspector and a note |
| `board-kanban.png` | A kanban room (ADR-267 §2.1, ADR-277): column headers with counts, cards in their column's colours on the green ground, the title plate |
| `board-kanban-export.png` | The same room as the exported PNG, drawn by the same painters; the pair shows the file matches the screen |
| `export.png` | The export dialog: scope, format, object count |
| `timer.png` | The shared timer panel and its countdown |
| `vote.png` | A voting session with two objects and the quota |
| `topbar-board-menu.png` | The room's menu: rename, settings, properties, access, export, a template, apps, danger |
| `topbar-facilitation.png` | «Провести ▾»: timer, voting, presentation, follow along and the reactions row |
| `topbar-people.png` | The people group: faces, roles, followers and watching guests (ADR-266 §4) |
| `topbar-account.png` | The account menu: name and role source, all rooms, theme, language, help |
| `topbar-dark.png` | The same header in the dark theme with a menu open |
| `brand-sign-in.png` | The sign-in dialog: the landing mark and «Ремука» wordmark above the form (ADR-272) |
| `brand-home.png` | The organisation home header: mark 30 px beside «Rooms» |
| `brand-help.png` | The help header: mark, «Вернуться к комнате», theme and language |
| `brand-help-dark.png` | The same help header in the dark theme: the smile becomes paper, the circle and square do not change |
| `rail.png` | The tool rail: two panels — tools with the pressed Select, history below |
| `rail-dark.png` | The same rail in the dark theme |
| `canvas-bottom.png` | The bottom edge: zoom with fit, and the one-time hint in its own slot |
| `vote-chips.png` | Two counters on a note and its neighbour: «0 +» and «1 · ваш − +» |
| `vote-chips-dark.png` | The same counters in the dark theme: plate, my accent, the muted disabled «+» |
| `vote-chips-overview.png` | The fitted room during a vote: each counter is only its number, and no object is covered (ADR-235) |
| `card-fields-panel.png` | A card's fields in the panel: status, assignee, and Start and Due one under the other, each showing its whole date (E-16) |
| `panel-room.png` | The properties panel with nothing selected: the room's name, its counts and the card filter (ADR-236) |
| `panel-kanban.png` | The panel with a kanban selected: selection actions and the kanban's state, without the room's counts |
| `agent-plan.png` | The plan preview in the room (ADR-188): two dashed notes joined by a dashed line, and the task panel with counts and bounds |
| `agent-plan-tidy.png` | The tidy preview in the room: five notes, their dashed ghosts in one column, the US block hull and the task panel |
| `section-panel.png` | A section in table view with its panel: view, axes and the top of the Header group |
| `section-panel-header.png` | The Header group scrolled into view: empty sizes read «Auto», with no unit |
| `rich-blocks.png` | Headings, three list levels, a checklist, a link and inline code on a text block and a note |
| `rich-blocks-dark.png` | The same block text in the dark theme: the paper note keeps its ink |
| `elevation.png` | A shape on the "Cardboard" level: a hard ink shadow offset by six board units, no blur (ADR-267) |
| `shapes.png` | Five kinds on one board with their kind switch open: a rounded rectangle, a rectangle, an ellipse, a diamond and a triangle, and connectors that meet the drawn outlines (ADR-271, T17) || `elevation-dark.png` | The same shape in the dark theme, where "Cardboard" is painted as "Floating" until the dark theme gets its own cardboard |

The automatic gate **compares** every screen with its PNG in one Linux browser (ADR-222).
A pixel counts as different when it differs by more than about 8 grey levels (threshold
0.03), and a screen fails when more than 20 pixels differ (ADR-238). Run-to-run noise
measured 2 levels; the background grid removed in M12 was 31. Times and generated names
are masked in the scenario. `e2e/visual.spec.ts` also samples pixels where the three
routings must differ and checks that every screen fits 1440×900; `e2e/a11y.spec.ts` runs
axe. A deliberate change regenerates the PNGs with `pnpm baselines`, which rewrites only
the screens that differ.
