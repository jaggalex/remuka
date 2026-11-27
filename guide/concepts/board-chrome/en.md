## The room screen: header, rail, bottom, menus

The screen has three zones and menus: the header describes the room and the session, the rail creates objects, the bottom controls the view, and menus open from the header and bring up dialogs. Menus are not a fourth zone: they are how commands inside the header are reached. Knowing the zone keeps you from hunting for a command across the whole screen.

## Header

On the left are the Remuka logo, a link to the team and the room menu. On the right are people, **Run**, **Agent** (when available), **Invite** and your account.

| Element | What it opens |
|---|---|
| Remuka logo | all rooms in the organisation. On the keyboard, press G then R |
| Team name | the rooms in this team |
| Room name ▾ | the room menu. Open **Properties and access** for permissions or the properties panel, and **More** for comments and settings. A count beside the room name shows unread comments |
| People | who is here, their roles, followers and guests by link; "follow" |
| **Run** ▾ | timer, voting, presentation, shared viewing, reactions |
| **Agent** ▾ | give the agent a task, ask the agent, agents and journal |
| **Invite** | participant roles and the public link — the screen's primary button |
| Account | name and `@handle`, all rooms, theme, language, help and keys, sessions, security, organisation, documents, sign out |

The centre of the header stays empty. Icon-only controls are named in a tooltip on hover or focus.

**Save status.** If a change takes over two seconds to reach the server, “Saving…” appears beside the room name. When the connection drops, “No connection” shows how many changes are waiting and a notice asks you to keep the tab open. Viewers see when updates from the team will return. Once the connection recovers, “Saved” appears for two seconds.

**Timer and voting** are states, not items. While a timer runs, a `04:12` chip sits to the right of **Run**; the last ten seconds turn red. While voting is open, the chip reads "Votes: 22". A chip appears on start, disappears on finish and opens **Run** at its section.

Below 900 px the room menu, people, **Run**, **Invite** and the account remain visible. Open the agent from the account menu. At any width, click the room name and choose **More → Comments**.

## Menus

| Menu | What it contains |
|---|---|
| Room name | rename, properties and access, export, copy link, move to trash. **More** contains appearance, settings, comments, restore, duplicate, templates, apps and replacement |
| **Run** | timer, voting, presentation, shared viewing, reactions |
| **Agent** | give the agent a task, ask the agent, agents and journal |
| People | participants with roles, "follow", followers and guests by link |
| Account | all rooms, find an action, theme (light, dark), language (Russian, English), calm animations, help, show the hints again, active sessions, security, organisation, documents, cookies, sign out. Theme, language and calm animations belong to the account and follow it to another device; before sign-in the browser choice applies |

## How to switch to dark mode

To turn on the dark theme in a room, open the account menu in the upper right and select Dark. To switch back, select Light in the same menu.

On the home page with the room list, click the sun icon in the upper right. Click the moon icon to switch back.

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
- Bottom centre: one hint about what can be done here. It waits until the action is learned: it goes away after three edits by double-click or after five visits to the room. Bring it back in the account menu → **Show the hints again**.
- While voting runs, the **Voting is on** line (or "Voting ended") takes this place: votes left, time, the facilitator and a way into the panel. The hint is not shown at the same time.
- Top left, beside the rail, the selection badge names the selected object's type, size, lock and tags.

## Chrome steps back

While you drag, rotate or draw on the canvas, the header, the rail and the bottom panel step back: they become 35 % opaque and stop taking clicks. They return 200 ms after the gesture ends. Keyboard work never quiets the chrome, and an open menu or dialog cancels it. With **Calm animations** or the system "reduce motion" setting the change is instant.

## Where to find what

| Task | Where |
|---|---|
| Create a sticky note, shape, text, frame or card | the rail on the left |
| Change a colour | the sample on the object bar or the palette in the rail |
| Open properties | room menu → **Properties and access → Properties** |
| Start a presentation | **Run ▾ → Start presentation** |
| Discuss an object | **Room menu → More → Comments** or a pin on the canvas |
| Start voting | **Run ▾ → Voting** |
| Change the theme or language | the account menu; with an account the choice follows you to other devices |
| Remove springs and transitions | the account menu → **Calm animations**; with an account the setting follows you to other devices |
| Bring the hints back | the account menu → **Show the hints again** |
| Find or end a session on another device | account menu → **Active sessions** |
| Invite a person or turn on the link | **Invite** |
| Add a template | room menu → **More → Templates…** |
| Set a task for an agent | **Agent ▾ → Give the agent a task** |
| Open all rooms | account menu → **All rooms** |
| Find an action by name | `⌘K`, **Find an action** at the bottom, or the account menu |

## What changes with a role

A viewer or commenter sees the room, but the creation rail is off: the tool explains that only an editor creates objects. A public-link visitor gets no agent, no export and no access management. For a role that may not grant access, **Invite** copies the link instead of opening the dialog.

## Where to go next

[Colour palette](/guide/concepts/colors) — what the tones, white, black and transparent mean.

[Quick start](/guide/start/quickstart) — walk the screen and get a working room.
