## Result

You find an action by its name, not from memory: press `⌘K` (`Ctrl K`) or click **Find an action** at the bottom of the room, and the command search opens. It holds everything you can do in the room, even when the button is hidden in a menu.

## Steps

1. Press `⌘K` or click **Find an action** at the bottom of the room. Result: the field “What to do?” opens.
2. Start typing: “export”, “timer”, “theme”. Result: the list narrows. Matches at the start of a title come first, then matches at the start of a word, then synonyms, including the other interface language.
3. Pick a row with the arrow keys and press `Enter`. Result: the command runs, the search closes and focus goes back where it was.
4. `Esc` closes the search without doing anything.

With no query the search shows the five commands this browser ran last and three context suggestions: with a selection, the actions on it; otherwise, the ways to run the session. The recent list lives in this browser, not in the account.

A grey row with a reason is a command that cannot run right now: “Select an object first”, “The editor role is required”, “Only on the Team plan”. `Enter` on it does nothing.

The search also creates: **card**, **table**, **kanban**, **comment**, **templates**, and **Edit text** for a selected object. The same rows are in **More** on the tool rail; there is no second list. It opens a task with your words; the agent does nothing without your **Apply**.

When nothing matches, the search says: “Nothing like that yet. Try another word — or ask the agent.”

## Check

- `⌘K` in a field or in the text editor does not open the search: there `⌘K` has its own job.
- “export” finds the room export; `Enter` opens the export window.
- After `Esc` focus returns to the button or the canvas where you were.
- The row **Find an action** is in the object's context menu and in the account menu.

## Limits

- The search looks at commands, not at the room's content: it does not find objects or text on the canvas.
- It does not remember commands from another browser or device.
- You can find a command that is unavailable, but you cannot run it: the reason is under the title.
