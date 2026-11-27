## When you need it

A card should carry more than text: it has a status, an assignee and a date. These fields show what is being done and when, without opening a separate spreadsheet.

## Prerequisites

- A card in the room or in a kanban.
- Edit rights in the room.

## Steps

1. Select a card and open **Properties**. The selected card’s text appears below the panel heading.
2. Use the status next to the panel heading to choose **To do**, **In progress** or **Done**. Result: the card shows a status indicator and a label.
3. Choose an assignee from the room's people. Result: the card shows the name; the email is not shown.
4. Set **Start** and **Due**. Result: the card shows a date range; either field can stay empty.
5. If the due date has passed, a reminder appears below the dates. You can assign tags and choose the card colour below.
6. To clear a value, choose **No status**, Unassigned, or clear the date.

## Card filter

1. Open the **Properties** panel and the **Card filter** block.
2. Click **+** in an empty kanban cell when the card does not exist yet: it is created in that column and swimlane and its text editor opens immediately. Then choose an assignee and a due state: any, overdue or no due date.
3. Click **Select cards**. Result: matching cards are selected, the others stay in the room.

## Check

- After a reload the status, assignee and dates are the same.
- An overdue date is marked `!` and by colour.
- Moving a card to another column does not change its status: the column is a place, the status is a state.
- The save indicator shows **saved**.

## Limits

- One assignee; multiple assignees are not in v1.
- Tags are a separate room vocabulary; up to 10 per object.
- A column's WIP limit is a warning, not a block.
- The picker lists people with access to the room; a link visitor is not included.

## Where to go next

[Tags and links](/guide/how-to/tags-links) — how to mark objects and reach a source.
