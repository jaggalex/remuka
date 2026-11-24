## Result

A saved room has no indicator — that is normal. When something is wrong, one of these appears next to the room name:

- **Saving…** — the acknowledgement is taking longer than two seconds. Usually you never see it: the server answers sooner.
- **No connection — edits will wait** — the connection dropped. Edits stay in this tab.
- **Input paused** — the offline queue filled up; the cause and what to do are written in words.

When the connection returns, **All saved** appears for two seconds, then the header is quiet again. "No connection" and "All saved" are announced by a screen reader; "Saving…" is not, so every keystroke is not read out.

## Offline

1. If the connection drops, keep working: edits stay in the document.
2. When the connection returns, the status changes to **Saving…**, then to **All saved**.
3. Wait for **All saved** before closing the tab.

If too many edits accumulate, input stops: **Input paused** appears, and a message appears above the room. This protects the queue from growing without bound. Reconnect and wait for **All saved** to continue.

## Too many edits

The server limits the write rate. If there are too many edits in a short time, it closes the connection and shows the reason. What you entered stays in the current tab: closing the connection cancels neither text nor inserted objects. A message about changes coming too fast appears above the room.

1. Stop the bulk action: a paste, a bulk move, or a change to many objects at once.
2. Wait for reconnect. Before retrying, the client waits 5 seconds and doubles the pause up to 60 seconds.
3. Continue once **All saved** appears.

## The room is full

The room has a size limit. When it is reached, the server accepts only small changes: typing, moving and deleting go through, a large paste does not. The connection closes because the room reached its size limit; the paste stays in this tab and is not saved.

1. Delete unneeded objects or large fragments from the room.
2. Wait for reconnect: the pause before retry starts at 30 seconds and doubles up to 5 minutes.
3. Paste again in smaller parts.

## Too many objects

A separate limit is the object count: 20,000 per room. When it is reached, the server does not accept new objects, but existing ones can be changed, moved and deleted. This is not the size limit: a room can take little space and still hit the object count. The connection closes as it does for a full room, but the cause is different.

1. Delete unneeded objects to reduce the count.
2. Wait for reconnect: the pause before retry is 30 seconds to 5 minutes.
3. Add new objects after the count drops below the limit.

## If access was revoked

If the owner changes your role while you work, the server closes the connection. The room stays on screen but becomes read-only, with an "Access changed" message. Save what you need before the change or ask for access again.

## What to check

- In a saved room, the space next to the name is empty.
- After an edit nothing appears for a moment; if the server is silent for more than two seconds, **Saving…** appears.
- Offline, **No connection — edits will wait** appears at once; after returning, **All saved** stays for two seconds.
- After a page reload, saved edits are still there.
- After a speed or limit close, the connection returns by itself; the status changes to **Saving…**, then **All saved**.
- In a full room a small edit saves, while a large paste does not.
- After deleting extra content, new objects can be added again.

## Limits

- Offline edits and edits waiting for reconnect live in the current tab. If the tab is closed before saving, unsent work is lost.
- The queue limit protects against unbounded growth; it is not a promise of unlimited offline work.
- The size limit and the object limit are set by the server. They do not delete data: the room stays readable and can be cleaned up.
