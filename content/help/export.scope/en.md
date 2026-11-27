## Result

The file contains exactly the chosen scope — the selected objects, one frame with its
contents, or the whole room — together with the connectors inside it. The dialog shows
the object count.

## Scopes

- **Selection** — the objects selected right now, and the connectors between them. If a frame or a kanban is selected, its child objects are included too.
- **Frame** — a frame and its contents. If the room has just one frame and nothing is selected, you can choose that frame in the export dialog. If there are several frames, first select the one you want or an object inside it on the canvas.
- **Whole room** — every object. This is the default when you open the dialog with nothing selected.

## Connectors in the scope

A connector is a relation between two objects, not a third object, so it goes into the
file together with both of its ends. A marquee drawn around two objects selects the
connector between them too.

- A connector whose other end is outside the scope is left out of the file: a line cut at the edge would claim a relation to an object the picture does not show.
- A connector between two cards of the same kanban counts as internal when the kanban is in the scope.
- A connector selected on its own is exported as before — clipped at the picture edge.

## Steps

1. Click the room name and choose **Export**. The menu entry lists the formats available to you.
2. Choose a scope. The object count is shown under the options.
3. Choose a format and click Export.

## Check the result

- The picture has no grid, selection outlines or other people's cursors: those are screen chrome, not the room.
- The object count in the dialog, connectors included, matches what the file shows.
- The Selection option is unavailable when nothing is selected on the canvas.

## Limits

- A very large room is exported at a lower resolution but in full: the limit protects the browser from running out of memory.
