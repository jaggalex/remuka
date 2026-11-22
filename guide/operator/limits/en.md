## What an operator can do

An operator works with metadata and money: finds a customer, reads the plan, subscription, invoices and payments, marks a payment, refunds money, grants credit, applies measures against abuse and reads the journal. Every change goes through a command with a reason and an author.

## What an operator cannot do

| Action | Why not | What to do instead |
|---|---|---|
| Open a customer's room or read its text, images or comments | the role gives no access to content: less access means less responsibility for other people's data | ask the complainant for a link, screenshot or excerpt |
| See room names in the customer card | the card shows the number of rooms only | a room name may appear in the measures list, which names the subject of a measure; the content never does |
| Edit documents, cards or comments | that is work for members with edit rights, not for an operator | ask the organisation administrator or a member |
| Grant or revoke a member's organisation role | member rights belong to the organisation administrator | contact the organisation administrator |
| Bypass a room's access check | there is no "see and change everything" mode: one access check serves everyone | use the ordinary access you hold as a member, if any |
| Grant the operator role through the interface or the API | that would create a path to gain rights through a hijacked browser | [a server command](/guide/operator/first-operator) |
| Set a plan, refund money or grant credit without an author | without one there is no evidence of who acted, and nobody to answer | a command with `--as`; refund and credit also require `--reason`; see [Money](/guide/operator/money) |
| Apply a measure without the letter to administrators | the rules of use promise a reason and an appeal | `--public` and configured mail; without them no measure is created |
| Turn off your own second factor while holding the role | the factor protects money and customer data | revoke the role on the server first |
| Delete the last administrator of a shared organisation | the organisation would be left unmanaged | appoint another administrator |
| Look at customers of the other installation | the EU and Russian installations have separate databases; personal data does not cross | ask the operator of that installation |
| Change or delete a journal row | the journal is evidence, not a working list | make a correct action, which adds its own row |

## Why the limits are drawn here

- **Customer data.** Rooms may hold personal data and trade secrets. Metadata is enough for support: who, which plan, what was paid, what has already been done. If a fragment is needed, the person asking for help sends it.
- **One access mechanism.** The room access check is the same for a member and for an operator. A second way to "take a look" would be a second check that sooner or later disagrees with the first.
- **A trace for every act.** Money, rights and measures change only through commands: they carry an author and a journal row, and refunds, credit and measures also carry a reason. A command without an author refuses, so a change never stays nameless.

## Where to escalate

| Question | Where |
|---|---|
| A vulnerability or a suspected account takeover | a private report through the repository's Security tab or `security@remuka.com`; do not open a public issue |
| A complaint about content | `abuse@remuka.ru` for the Russian installation, `abuse@remuka.com` for the EU; a reply to the letter also reaches us |
| A request to access, correct or delete personal data | `privacy@remuka.ru` or `privacy@remuka.com`, depending on the installation's zone |
| Money, invoices, refunds | `support@remuka.ru` or `support@remuka.com`; the refund itself is performed by an operator |
| A reproducible product bug | the repository's issues; include the version, the steps and what is on screen |
| The server, database, TLS or backups | the server owner and the installation administrator; this is outside the operator role |
| A court or authority request | follow the document and do not delete data before consulting the zone's lawyer |

## Check

- Any request to `/api/operator/...` under an account without the role answers 404, even if the address is guessed.
- The console has no button that changes room content or a member's rights.
- `customer:show` shows the number of rooms but not their names.
- `billing:grant` without `--as` refuses; with it, it leaves a `billing.plan_granted` row.
- A measure without `--public` refuses and writes no record.

## If something goes wrong

| Situation | What to do |
|---|---|
| Someone asks you to "take a look inside the room" | explain that the role gives no content access and ask for a link or screenshot |
| Someone insists on an action without a reason | the command will refuse; without a reason there is no evidence either. Record the request in the ticket |
| You need a member's rights in an organisation | the organisation administrator grants them, not an operator |
| A measure must be lifted but mail is down | `abuse:revert` restores access; tell the administrators by hand |
| A customer writes about the other installation | pass the request to that installation's operator: databases and customers are not shared |
| You need the role and do not have it | [The first operator](/guide/operator/first-operator) and [Two-factor sign-in](/guide/operator/totp) |

## Where next

[The first operator](/guide/operator/first-operator) — where to start when the role has not been granted to anyone yet.
