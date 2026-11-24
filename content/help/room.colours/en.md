## Result

An object has several roles: sheet or fill, border, text, line and connector label. Each takes its value from one palette — seven tones at three levels plus white, black and transparent. A colour is changed on the object bar, in the rail or with keys 1–7, and has the same name everywhere.

## The grid

Seven tones run in columns: grey, yellow, orange, pink, violet, blue, green. Levels 100 and 300 are fills; 600 is for lines, borders and text.

| Tone | 100 | 300 | 600 |
|---|---|---|---|
| Grey | Grey | Warm grey | Graphite |
| Yellow | Yellow | Bright yellow | Deep ochre |
| Orange | Orange | Coral | Terracotta |
| Pink | Pink | Rose | Deep raspberry |
| Violet | Violet | Bright violet | Deep violet |
| Blue | Blue | Bright blue | Deep blue |
| Green | Green | Bright green | Deep green |

## Named colours

White and Black stand in a separate column to the left of the grid. A shape's **Fill** also offers **Transparent**, and a **Border** or a **Line** offers **None**: both are the same stored value, but a role without a fill and a role without a line are named differently. Transparent is drawn as a checkerboard.

A sticky note has no transparency: its sheet is the object.

## Where to change a colour

- **A new sticky note.** The caret beside the Sticky note tool in the rail opens the palette: 14 fills plus White and Black. Yellow is marked as the default.
- **A sticky note.** Click the sample on the object bar to open **Sheet colour** and **Text**.
- **A shape.** The sample opens presets, **Fill**, **Border** and **Text**.
- **Text.** On a sticky note or a shape the **Text** role offers **Auto, Dark, Black, White**; on free text it offers **Auto, Black, White**.
- **A connector.** The sample opens **Line** (**Auto, Black, None**), and when the connector has text, also **Text** (the connector label): **Auto, Black, White**.
- **Several objects.** On the selection bar the sample shows the shared fill or line. Mixed colours means the objects disagree.
- **A kanban column.** Right-click its header to open **Column colour**: 14 swatches. Cards without a colour of their own follow the column, and the header shows the tone; the stripe under the title is gone.
- **A card.** Right-click a card to open **Card colour**: 14 fills and **Same as column**.

## Keys 1–7

A digit picks a tone and paints the main role of the selection:

- sticky notes and shapes get a fill; the 100 or 300 row is kept, and different rows fall back to 100;
- a connector gets its line, always 600;
- text gets its colour, always 600.

A key works when only objects with that role are selected. In an input field, a menu or a dialog, a digit stays a digit. Named colours have no number.

## Auto and readability

**Auto** is the absence of a colour on the object. That is how the window names a new text, a label and a line, and how it reads old objects that still carry the former grey or near-black default. No colour is stored: it is worked out from the surface under the object — ink on light paper, paper on dark. So text and lines read in both themes, and an object's fills do not follow the theme.

If a chosen colour almost disappears on its background, the object keeps your colour but gets a thin outline, and the window says **"Hard to read on this background"** and offers **Auto**. It is a hint, not a replacement: the colour changes only when you press it.

## Custom colour

A value outside the palette is labelled **Custom colour** below the grid. That is a label for the value, not a swatch to pick: only palette values can be chosen. The current value is kept until you choose another: the room is not repainted after the fact.

## Kanban cards

A card without a colour of its own takes its column's: white in a grey column, yellow in a yellow one, green in a green one. The colour is worked out when the board is drawn, so moving a card recolours it at once and writes nothing into the card.

A chosen colour is stronger than the column and survives a move. **Same as column** clears it. A column header reads **"Name · 2/3"**; over the limit it turns red, and the extra cards get a dashed outline.

## Sticky notes from the previous palette

The 100 and 300 fills are the landing page's tones: bright, with dark text on every one. A sticky note painted with the muted paper tones keeps them: the window names its colour by tone and level, for example **Yellow**, and marks that swatch. Click the swatch or press the digit and the note takes the new tone. An administrator can repaint every room at once with `pnpm db:repaint`.

## Check the result

- The rail and the sticky note window show the same 14 fills in the same order, with White and Black in a separate column.
- The name on the sample matches the name of the chosen swatch in the window.
- After pressing 4, a sticky note becomes pink on its previous level.
- A card in a grey column is white, in a yellow one yellow; after a move to a green column it is green, and the card has no colour in the document.
- An object with Custom colour stays that way until you pick a colour from the palette.

## Limitations

- Colour does not affect access rights.
- A sticky note has no transparency; free text and a connector label have the Auto / Black / White control, while sticky note and shape text has Auto / Dark / Black / White.
- The palette does not change an object's type, layer or size.
