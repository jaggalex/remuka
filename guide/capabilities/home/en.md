## What it gives

The home page is one organisation's directory. Instead of an empty canvas you see room
tiles: emoji, title, team, author, creation date and update date. The same screen carries
name search, sorting and pages.

The address says where you are: `?room=<id>` opens a room, `?org=<slug>` opens the
organisation home. Switching organisation leaves the room: the previous organisation and
its room are left behind instead of becoming a filter over an open canvas.

## When to use it

- You need to switch between a personal and a work organisation.
- You need to find a room by name among many.
- You need to create a room in a specific organisation.
- You need an emoji so a room stands out in the list.

## How it works

1. The account menu → **All rooms**, or the organisation name, opens the home.
2. The **Organisation** field switches context. The personal organisation carries the
   **Personal** badge; every account has one, even a person working alone.
3. Search looks at the room name. Sort by updated, created, name or author; the arrow
   changes direction. Newest-updated comes first by default.
4. Tiles flow left to right, then top to bottom, 24 per page. Page numbers sit below.
5. A tile shows the team (or the organisation when the room has no team), the author `Name @handle` and the dates. Author means creator;
   handing over ownership does not rewrite it.
6. Open **⋯ → Cover and icon** on any tile. Search for an emoji by name and select it. Inside the room, open the title menu for the same picker. Choose **No emoji** to remove the icon.
7. **New room** creates a room in the chosen organisation.
8. **Trash** beside **Rooms** shows deleted rooms; **Restore** puts a room back in the list.

The cover shows the canvas. To feature a frame, open its context menu and choose **Make cover**. Choose **Use whole room as cover** in the same menu to restore the canvas view. After an edit, the preview refreshes automatically at most once every ten minutes, even when the room is closed.

## Example

Input: a person belongs to a personal and a work organisation. Action: they open **All
rooms**, choose the work organisation, sort by name and open a room. Result: the list
shows only the work organisation's rooms, and the chosen room opens at `?room=…`.

## Limits

- Creation dates of old rooms were restored from the update date and may be approximate.
- Search is by room name, not by canvas content.
- There is no "all organisations at once" mode: the directory always belongs to one
  organisation.

## Practical instructions

[Create a room](/guide/how-to/create-board) — step by step. [Account and team](/guide/how-to/account) — name, handle and organisations.

## Related capabilities

[Access and roles](/guide/capabilities/access), [presentation](/guide/capabilities/presentation).
