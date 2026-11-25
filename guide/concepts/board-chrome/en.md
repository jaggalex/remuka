## The room screen: header, rail, bottom, menus

The screen has three zones and menus: the header describes the room and the session, the rail creates objects, the bottom controls the view, and menus open from the header and bring up dialogs. Menus are not a fourth zone: they are how commands inside the header are reached. Knowing the zone keeps you from hunting for a command across the whole screen.

## Header

The header has eight places, and a calm room shows exactly eight. On the left are the Remuka mark and the path with the room name; on the right are people, **Run**, **Agent**, discussion, **Invite** and the account. Everything else lives in those eight menus and is found there by its name.

| Element | What it opens |
|---|---|
| Mark | the account menu: all rooms, theme, language, help, sign out |
| Path and room name ▾ | rename, settings, properties, access, export, restore, copy, link, template, apps; below the line, replace and trash |
| People | who is here, their roles, followers and guests by link; "follow" |
| **Run** ▾ | timer, voting, presentation, shared viewing, reactions |
| **Agent** ▾ | give the agent a task, ask the agent, agents and journal |
| Discussion | the comments panel; the counter shows unread and hides zero |
| **Invite** | participant roles and the public link — the screen's primary button |
| Account | name and `@handle`, all rooms, theme, language, help and keys, sessions, security, organisation, documents, sign out |

The centre of the header stays empty. Icon-only controls are named in a tooltip on hover or focus.

**The save state** appears only when something is wrong. A saved room has no indicator; "Saving…" shows if the acknowledgement takes longer than two seconds; "No connection — edits will wait" appears at once; after coming back, "All saved" stays for two seconds.

**Timer and voting** are states, not items. While a timer runs, a `04:12` chip sits to the right of **Run**; the last ten seconds turn red. While voting is open, the chip reads "Votes: 22". A chip appears on start, disappears on finish and opens **Run** at its section.

On a narrow screen (below 900 px) the name, people (up to two faces), **Run** as an icon, **Invite** and the account stay. Agent and discussion move into the account menu, and a running session becomes a dot on the **Run** icon.

## Menus

| Menu | What it contains |
|---|---|
| Room name | rename, settings, properties, access, export, restore, copy, link, template, apps, replace with a template, trash |
| **Run** | timer, voting, presentation, shared viewing, reactions |
| **Agent** | give the agent a task, ask the agent, agents and journal |
| People | participants with roles, "follow", followers and guests by link |
| Account | all rooms, find an action, theme (light, dark), language (Russian, English), help, active sessions, security, organisation, documents, cookies, sign out. Theme and language belong to the account and follow it to another device; before sign-in the browser choice applies |

## Command search

`⌘K` (`Ctrl K`), the **Find an action** button at the bottom of the room or a row in the account menu open the command search. It looks at titles and synonyms, both interface languages included: “export”, “экспорт” and “выгрузить” find the same command. Arrows choose, `Enter` runs, `Esc` closes and returns focus where it was.

With no query the search shows the five commands this browser ran last and three context suggestions: with a selection, the actions on it; without, the ways to run the session. An unavailable command stays visible, grey, with its reason: “Select an object first”, “The editor role is required”, “Only on the Team plan”; `Enter` on it does nothing.

When agents are allowed in the room, the last row is **Ask the agent: …**. It opens a task with your words and runs nothing by itself.

## Rail

The rail is the vertical toolbar on the left. It creates objects straight into the current view: there is no "place the object" mode, and the tool returns to Select after creation.

| Tool | Key | What it does |
|---|---|---|
| **Select** | `V` | clears the selection and returns the ordinary gestures |
| **Sticky note** | `N` | creates a sticky note; the caret opens the new sticky note's palette |
| **Text** | `T` | creates a text object |
| **Shape** | `R` | creates a rectangle; the caret offers a rectangle, an ellipse and a diamond |
| **Connector** | `L` | starts joining two objects |
| **Frame** | `F` | creates a frame section |
| **Card** | `C` | creates a card in the selected kanban or cell |
| **Comment** | — | places a comment on an object or a point |

Below, in a separate panel, sit **Undo** and **Redo**: history is not a creation tool.

## Bottom and edges

- Bottom left: **Find an action** (`⌘K`) and the zoom: `−`, the percentage, `+` and **Fit**. Fit can frame everything or just the selection.
- Bottom centre: the first-visit hint. It disappears after the first gesture on the canvas or after a few seconds.
- While voting runs, the **Voting is on** line (or "Voting ended") takes this place: votes left, time, the facilitator and a way into the panel. The hint is not shown at the same time.
- Top left, beside the rail, the selection badge names the selected object's type, size, lock and tags.

## Where to find what

| Task | Where |
|---|---|
| Create a sticky note, shape, text, frame or card | the rail on the left |
| Change a colour | the sample on the object bar or the palette in the rail |
| Open properties | room menu → **Properties** |
| Start a presentation | **Run ▾ → Start presentation** |
| Discuss an object | the discussion icon in the header or a pin on the canvas |
| Start voting | **Run ▾ → Voting** |
| Change the theme or language | the account menu; with an account the choice follows you to other devices |
| Find or end a session on another device | account menu → **Active sessions** |
| Invite a person or turn on the link | **Invite** |
| Add a template | room menu → **Templates…** |
| Set a task for an agent | **Agent ▾ → Give the agent a task** |
| Open all rooms | account menu → **All rooms** |
| Find an action by name | `⌘K`, **Find an action** at the bottom, or the account menu |

## What changes with a role

A viewer or commenter sees the room, but the creation rail is off: the tool explains that only an editor creates objects. A public-link visitor gets no agent, no export and no access management. For a role that may not grant access, **Invite** copies the link instead of opening the dialog.

## Where to go next

[Colour palette](/guide/concepts/colors) — what the tones, white, black and transparent mean.

[Quick start](/guide/start/quickstart) — walk the screen and get a working room.
