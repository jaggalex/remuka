## Result

A card keeps a status, one assignee and a date range. These fields appear on the card and are edited on the **Properties** panel; they do not replace the kanban column.

## Steps

1. Select a card in the room, or click **+** in an empty kanban cell: the card is created in that column and swimlane and its text editor opens immediately.
2. Open **Properties**. The selected card’s text appears below the panel heading.
3. Use the status next to the panel heading to choose To do, In progress or Done. Choose **No status** to clear it.
4. Choose an assignee from the room's people, or leave it Unassigned.
5. Set a start and a due date. Either can be empty; the card then shows one date.
6. To clear a date, remove its value.

Use **Tags** to assign tags. Under **Card colour**, choose **Same as column** or **Custom colour**. A reminder appears below the dates when the due date has passed.

## Check the result

- The card shows its status, assignee name and dates.
- The values are the same after a reload.
- An overdue date is marked `!` and by colour, not colour alone.
- The save indicator shows saved.

## Limits

- Status and column are independent: moving a card to another column does not change its status.
- One assignee; multiple assignees are not in v1.
- The assignee's email is not shown on the card.
- The picker lists people with access to the room; a link visitor is not included.
- Tags are a separate room vocabulary; add them to a card in the **Tags** block (up to 10 per object).
