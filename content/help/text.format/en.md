## Result

A sticky note, a text or a shape keeps a line format — a heading, a list or a checklist — and marks inside a line: bold, italic, underline, strikethrough, code and a link. The formatting lives in the object's text: everyone in the room sees it, and it survives a reload.

## Line format and marks

| Action | Keys |
|---|---|
| Ordinary line | `⌘⌥0` |
| Heading 1 / Heading 2 | `⌘⌥1` / `⌘⌥2` |
| Bulleted list | `⌘⇧8` |
| Numbered list | `⌘⇧7` |
| Checklist | `⌘⇧9` |
| Bold / italic / underline | `⌘B` / `⌘I` / `⌘U` |
| Strikethrough | `⌘⇧X` |
| Inline code | `⌘E` |
| Link | `⌘K` |
| Clear formatting | `⌘\` |
| Paste without formatting | `⌘⇧V` |

1. Double-click the object and put the caret in a line, or select lines.
2. Press a shortcut. Pressing it again removes the format, and `⌘⌥0` returns an ordinary line.
3. `Tab` in a list item adds a level and `⇧Tab` removes one; on an ordinary line `Tab` starts a bulleted list.
4. `Enter` continues the list and leaves it from an empty item; the line after a heading is ordinary.
5. On Windows and Linux use `Ctrl` for `⌘` and `Alt` for `⌥`.

The format bar above the object teaches the same formats: see “Format bar”.

## Format bar

Select a sticky note, a text or a shape. The object panel shows a format bar: **H1**, **H2**, a bulleted list, a numbered list, a checklist, inline code and a link.

While the editor is open, the bar shows the format of the line with the caret or of the selected lines, and a press applies to them. After the editor closes it shows the object's common format, and a press changes all of its lines. When the lines differ, no button is pressed.

The link button works only while editing: for a new link, select the text first. The **More** menu on the object panel holds **Increase indent**, **Decrease indent**, **Open link** (when the object has exactly one link) and **Clear formatting**.

## Links

Select text and press `⌘K`. In the **Link** window, enter an address and press `Enter` or **Apply**. `example.com` becomes `https://example.com/`, and an e-mail address becomes `mailto:address`. Only `http`, `https` and `mailto` are accepted; the window refuses any other address.

To change a link, put the caret in it and press `⌘K` again. **Remove link** takes the link away and keeps the text. `Esc` closes the window and returns the caret to the text.

In the editor, `⌘Enter` on a link opens it in a new tab, while a plain `Enter` starts a new line. On the board, `⌘`/`Ctrl`+click opens a link; a plain click selects the object.

## Markdown while typing

Type a marker at the start of a line, then a space:

| Typed | Line |
|---|---|
| `# ` / `## ` | Heading 1 / Heading 2 |
| `- `, `* `, `+ ` | Bulleted list |
| `1. ` | Numbered list |
| `[ ] ` | Checklist |
| `[x] ` | A ticked checklist item |

`Backspace` right after a rule fires brings the typed characters back. The rules are on by default and are turned off in **Room settings → Text → “Markdown rules while typing”**; this is a personal setting.

## Paste

An ordinary paste understands headings, lists, checklists, bold, italic, underline, strikethrough, inline code and links from an HTML fragment, Docs, Notion, Word and the web. Fonts, colour, size and pictures are not transferred.

When the clipboard holds only text with Markdown marks, the paste builds headings, lists and checklists and understands `**bold**`, `*italic*`, `~~gone~~`, `` `code` `` and `[text](https://example.com)`. `⌘⇧V` pastes plain text: the markers stay as characters.

When objects copied in the room are pasted while the editor is open, the editor closes and the objects land beside the note. The note's text does not change.

## Copy

Select text in the editor and press `⌘C`: the clipboard gets HTML and Markdown. Docs, Notion, Word and mail understand the HTML; a chat and a Markdown editor understand the Markdown. Headings, lists, checklists, links and inline code survive, and a paste into another note turns them back into formats.

`⌘X` cuts the same way. A copy of an object on the board keeps its line formats.

## Checklist on the board

Close the editor and click the box in a checklist item. The item is ticked or unticked; this needs edit permission in the room and an unlocked object. The object stays selected, and one `⌘Z` undoes the change.

## Check

- After the editor closes, the board shows the same view as the edit did.
- A teammate and a reload show the same headings, lists and levels.
- A link opens with `⌘Enter` in the editor and with `⌘`/`Ctrl`+click on the board.
- Copied text pasted into another note keeps the same headings, lists and checklist.
- One `⌘Z` undoes a change of format, a link and a tick.

## Limits

- Two heading levels, and three indent levels for lists.
- A sticky note, a text and a shape take a line format; a connector label takes marks inside a line only, and a card stays plain text.
- There is no colour or size for single words, no per-line alignment and no quotes. Code is a mark inside a line only; there is no separate code block.
- Links are `http`, `https` and `mailto` only.
- The number in a numbered list is counted from the order of lines.
- A table is not stored as a table.
