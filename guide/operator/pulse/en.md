## What this is

**Pulse** is the console's first screen. It answers "how is the installation doing": how many teams work together, how much money arrives, whether new organisations reach their first result, whether they come back, and whether the server is healthy.

Pulse counts this installation's data only. The EU and Russian installations have separate databases, so one installation's customers and revenue never appear in the other's Pulse.

## Tiles

The top row has six tiles. A tile shows a value for the last complete week. Collaboration and new organisations also show the change from the previous week and a line for the chosen period; the others have neither, because the previous period cannot be restored.

| Tile | What it means | Where the data comes from |
|---|---|---|
| Weekly active collaborative teams | organisations where at least two people did a value action during the week | metrics events |
| MRR | active subscriptions normalised to a month, in the chosen currency | subscriptions in the installation's database |
| Paying teams | organisations with an active paid subscription, plus the "N of 43" bar to break-even (the installation can change the threshold) | subscriptions in the installation's database |
| Activation 7d | the share of the week's organisations that reached their first useful result within 7 days | metrics events |
| Retention W4 | the share of the week's organisations that came back in week four | metrics events |
| New organisations | organisations created during the week | the installation's database |

The filters above the tiles set the period (4, 12 or 26 weeks) and the currency of the total. The currency affects the money tiles; an installation that sells in one currency offers one choice.

Below are collapsed sections: **Growth**, **Engagement**, **Money**, **Health**. Health shows undelivered mail for the week, save errors, AI gateway refusals and WebSocket refusals.

## Why "—" instead of zero

Zero is a claim: "nobody paid this week". "—" is an admission: "this cannot be counted". Pulse tells them apart and writes the reason next to the dash.

- With no metrics database, activation, retention and collaboration show "—" with the reason "the metrics database is not configured".
- With no organisations in the cohort, a share is undefined, so it is "—", not 0%.
- With no paid subscription in a known currency, MRR shows "—": there is nothing to add up and no currency to add it in.
- The current week is still running. The tiles show the last complete one, so an unfinished week does not look like a fall.

A real zero still appears as zero: "New organisations" reads 0 when genuinely nobody signed up that week.

## What Pulse does not show

- **Room content or room names.** Metrics count events and organisations, not documents.
- **People by name.** Engagement is numbers: DAU, WAU, MAU, stickiness. Pulse does not show who signed in.
- **The other installation.** Zones are not merged: the screen shows this one only. Shared aggregates will come later and will be labelled.
- **Sign-up sources.** Until the installation collects them, the growth section says so.
- **Free → paid conversion.** It needs monthly aggregates that do not exist yet.
- **Collaborative sessions.** This version does not emit the shared-edit event, so the row stays empty with a reason.
- **The current week and today.** An unfinished period is not drawn as a point.

## Check

- The **Pulse** tab shows six tiles and the note "The current week is still running; the tiles show the last complete one."
- Switching 4 / 12 / 26 weeks changes the period and the line where one exists.
- Under every "—" there is a reason, not a blank.
- MRR equals the sum of active subscriptions in the chosen currency; verify it against customer cards.
- With the metrics database off, Pulse still opens: money and organisation tiles are computed, the rest are honestly empty.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| Every tile shows "—" | the service cannot read the metrics database or subscriptions | check the metrics database connection string and that the installation's database is reachable |
| MRR is "—" while paying teams shows 0 | no subscription in any known currency | check that an organisation has an active subscription and that the installation knows its currency |
| The numbers do not move | Pulse reads complete periods | wait for the week to end; today never enters a tile |
| Collaboration shows "—" | the metrics database is not configured or the event is not emitted yet | expected for this version; the reason is under the tile |
| Health shows "—" | the server's counters are unavailable | check server metric collection; the other sections do not depend on it |

## Where next

[Customers](/guide/operator/customers) — how to find the organisation behind a tile and answer a request.
