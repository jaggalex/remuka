## Result

One panel lives on the right: the **Properties** of the selection, **Comments**, or the agent. Opening another one closes the first; `Esc` closes it. The properties panel describes one subject: the selected object, or the room itself when nothing is selected. Open it from **Properties** in the room menu or with **⋯** on an object bar.

## What the panel shows

| Selected | In the panel |
|---|---|
| Nothing | the room's name, **In the room** — how many objects of each type — and the **Card filter** |
| A sticky note, a shape or text | the colour grid, **Text** (**Auto**, **A−**, **A+**, alignment), then **More settings** |
| A kanban | **More settings** → **Kanban state**: columns, swimlanes and WIP limits |
| A section, a card or another object | **More settings** with that object's fields |
| Several objects | selection actions and shared properties |

**More settings** is a folding row: text colour, note size, **Pin in place**, **Edit text**, name and link, tags, selection actions. The rare actions are under **⋯ More actions**. The object ID is in **⋯ → Info**.

## Danger zone

At the panel's foot: **Delete** and the hint “Delete can be undone with ⌘Z”. A delete asks first when it may take connectors with it; one `⌘Z` brings the object back.

## Shadow

A kanban, a section and a shape can be lifted off the board: **⋯ More actions → Shadow → None, Raised, Cardboard, Floating**; the current level is checked. There is one shadow per level; its colour and size are shared by the whole room and follow the theme. **Cardboard** is a hard shadow without blur: the object stands on the board like a button on a page. With several such objects selected, the choice gives them all one level, and one undo puts the previous ones back.

There are no **Shadow** items when the selection holds a sticky note or a card: they have their own paper shadow.

## Check

- Clear the selection: the panel shows the room's name and counts.
- Select a kanban: the panel shows its columns and limits, and no room counts.
- Select a shape and choose **⋯ → Shadow → Floating**: a soft shadow appears under the shape, and the next time the menu opens **Floating** is checked.
- Choose **Cardboard**: the shadow becomes hard, offset, with no blur.

## Limits

- Replacing the room with a template is in the room menu (the arrow by its name), not in the panel.
- One panel at a time: opening comments or the agent closes this one; `Esc` closes the open one.
- `⋯` on an object bar opens this panel, not a second menu.
- The card filter shows only with nothing selected: after **Select cards** the found cards are selected, and the panel shows them.
