## Result

The object is turned by the angle you chose: a shape, sticky note, free text, image or frame. Its text, connectors and fill turn with it, and its neighbours stay where they are.

## Steps

1. Select one object or several. A round handle on a stem appears above the middle of the top side.
2. Drag the handle — the object turns about its centre; several objects turn about their common centre. A plate beside the pointer shows the angle.
3. Release at the angle you want. `Shift` rounds the turn to 15°, and without it the angle softly snaps to 0°, 90°, 180° and 270° within 3°.
4. `⌘⇧←` and `⌘⇧→` turn the selection by 15°. **Rotate 90°** and **Reset rotation** are in the object menu.

## Check

- When a turned shape is resized, the opposite corner stays put and `Shift` keeps the proportions.
- A connector meets the turned outline at any angle and rebuilds while the object turns.
- A double click opens the text editor at the same angle as the drawing.
- Presentation, PNG/PDF export and backup keep the angle; a second participant sees it at once.
- One undo takes the whole gesture back.

## Limits

- Kanban, tables, connectors and cards do not turn: their grid stays straight and connector labels stay horizontal (ADR-213).
- There is no flip; text cannot be turned separately from its object.
- The angle is stored between −180° and 180°; 270° reads as −90°.
