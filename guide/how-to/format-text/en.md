## When you need it

Text in a room is read, not only written. A heading separates a section, a list holds steps, a checklist gathers items with a box, a link leads to the source. All of it lives in the same sticky note, text or shape: a heading needs no second object.

## Before you start

- You have edit permission in the room.
- The object is a sticky note, a text or a shape.

A card stays plain text, and a connector label has marks inside a line only.

## How to format

1. Double-click the object. Result: the editor opens, and each line is a separate paragraph.
2. Put the caret in a line, or select several lines.
3. Press a shortcut from the table below or a button on the format bar. Result: the line changes at once; pressing it again removes the format.
4. Press `Enter` at the end of an item. Result: the next item of the same kind and level; in an empty item `Enter` returns an ordinary line.
5. Press `Tab` in a list item. Result: one level deeper, `⇧Tab` one level up. There are three levels.
6. Close the editor. Result: the board shows the same view as the editor did, and one `⌘Z` undoes the change.

## Shortcuts

| Action | Keys |
|---|---|
| Ordinary line | `⌘⌥0` |
| Heading 1 | `⌘⌥1` |
| Heading 2 | `⌘⌥2` |
| Bulleted list | `⌘⇧8` |
| Numbered list | `⌘⇧7` |
| Checklist | `⌘⇧9` |
| Bold | `⌘B` |
| Italic | `⌘I` |
| Underline | `⌘U` |
| Strikethrough | `⌘⇧X` |
| Inline code | `⌘E` |
| Link | `⌘K` |
| Clear formatting | `⌘\` |
| Paste without formatting | `⌘⇧V` |
| Open a link in the editor | `⌘Enter` |
| Indent a list item | `Tab` / `⇧Tab` |
| Next item | `Enter` |

On Windows and Linux use `Ctrl` for `⌘` and `Alt` for `⌥`.

A shortcut applies to the line with the caret, or to the whole selection.

## Format bar

Select a sticky note, a text or a shape and a bar appears above it. It has seven elements: colour, text size (**Aa · Auto**) and the most frequent controls, with the rest behind **⋯**. While the editor is open the bar carries only formats: **bold**, *italic*, strikethrough, bulleted list, checklist, link and **⋯**.

A press applies to the line with the caret or to the whole selection. **⋯** opens the properties panel on the right: **underline**, **Heading 1/2**, numbered list, inline code and **Clear formatting**. There is one panel: opening comments closes it.

**Increase indent**, **Decrease indent** and **Open link** (when the object has exactly one link) stay in **More settings** of the properties panel.

## Links

1. Select text in the editor and press `⌘K`. Result: the **Link** window opens with the **Address** field.
2. Enter an address. `example.com` is completed to `https://example.com/`, and an e-mail address to `mailto:address`.
3. Press `Enter` or **Apply**. Result: the text becomes a link, and everyone in the room sees it the same way.
4. To change or remove a link, put the caret in it and press `⌘K`. **Remove link** takes the link away and keeps the text.
5. Press `Esc` to close the window and return the caret to the text.

Only `http`, `https` and `mailto` are accepted: the window refuses `javascript:` and other schemes.

In the editor, put the caret on a link and press `⌘Enter` to open it in a new tab. A plain `Enter` starts a new line. On the board, `⌘`/`Ctrl`+click opens a link, while a plain click selects the object.

## Checklist on the board

1. Close the editor.
2. Click the box in a checklist item. Result: the item is ticked or unticked, and the object stays selected.

The change needs edit permission in the room and an unlocked object; one `⌘Z` returns the previous state.

## What a paste carries

An ordinary paste goes through a white list: only what the object can store reaches it. That is why the board never shows markup that the edit did not.

| Source | What reaches the object |
|---|---|
| Google Docs, Notion, Word | headings, paragraphs, bulleted and numbered lists, checklists, bold, italic, underline, strikethrough, inline code and links |
| A web page | what the object can store: headings, lists, marks, code and links |
| Plain text with Markdown markers | headings, lists, checklists, marks, code and links; see below |
| Any source with `⌘⇧V` | plain text without marks or formats |

A checklist survives when the source marks it as a list with boxes. Fonts, size, colour and pictures are not transferred: a picture is a separate object.

When objects copied in the room are pasted while the editor is open, the editor closes and the objects land beside the note. The note's text does not change.

## Pasting Markdown

When the clipboard holds no HTML, the paste recognises Markdown — that is how an answer from an AI chat arrives. `# ` and `## ` give headings, `- ` and `1. ` give lists, `- [ ] ` gives a checklist, `**bold**`, `*italic*` and `~~gone~~` give marks, backticks give inline code, and `[text](https://example.com)` gives a link. Lines inside triple backticks arrive with the code mark.

## Markdown while typing

A marker typed at the start of a line becomes a format as soon as a space follows it:

| Typed | The line becomes |
|---|---|
| `# ` / `## ` | heading 1 / 2 |
| `- `, `* `, `+ ` | a bulleted list |
| `1. ` | a numbered list |
| `[ ] ` | a checklist |
| `[x] ` | a ticked checklist item |

`Backspace` right after a rule fires brings the typed characters back. The rules are on by default; the switch is **Room settings → Text → “Markdown rules while typing”**. It is a personal setting: your teammates keep their own.

## Copying

1. Select text in the editor and press `⌘C`. Result: the clipboard gets HTML and Markdown.
2. Paste into Docs, Notion, Word or a letter — the HTML arrives with headings, lists and marks. Paste into a chat or a Markdown editor — the Markdown arrives.
3. Paste into another note in the room. Result: the same headings, lists, checklists, links and code.

`⌘X` cuts the same way. A copy of an object on the board keeps its line formats.

## Clearing formatting

`⌘\` removes every mark and the line format from the selected lines or the line with the caret; the text stays. With the editor closed, **Clear formatting** in the **More** menu does the same to the whole object. One `⌘Z` undoes it.

To remove only a line format, press its shortcut again; `⌘⌥0` returns an ordinary line.

## Check

- The editor and the board show the same headings, lists and levels.
- After a reload the format is still there, and a teammate sees the same lines.
- A link opens with `⌘Enter` in the editor and with `⌘`/`Ctrl`+click on the board.
- Copied text pasted into another note keeps the same headings, lists and checklist.
- One `⌘Z` undoes a change of format, a link and a tick.

## Limits

- Two heading levels, and three indent levels for lists.
- There is no colour or size for single words, no per-line alignment and no quotes. Code is a mark inside a line only; there is no separate code block.
- Links are `http`, `https` and `mailto` only.
- The number in a numbered list is counted from the order of lines: a new item in the middle shifts the numbers below.
- A table is not stored as a table, and a picture remains a separate object.

## Where to go next

[Build a room](/guide/how-to/build-board) — frames, sticky notes and connectors around the text.

[Text keys](/guide/reference/keyboard) — the same table in the reference.

[Canvas and objects](/guide/capabilities/canvas) — how objects behave on the board.
