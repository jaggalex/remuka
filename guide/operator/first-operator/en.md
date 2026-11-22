## What you get

A confirmed account holds the installation operator role, and you can open `/operator` after enrolling a second factor. The role is granted from the server only: the app has no route for it.

## Before you start

- Access to the server and to the release directory the service runs from.
- An account registered in the usual way, with a confirmed address. An unconfirmed account cannot hold the role.
- The release environment loaded: the command reads `.env` from the directory you run it in and takes the database connection string from there.
- A decision about who else will be an operator. Keep two: resetting a second factor is done by another operator.

## Steps

1. Register in the app and confirm the address from the letter.
2. On the server, in the release directory:

   ```sh
   cd /srv/remo
   pnpm operator:grant --email ops@example.com --as ops@example.com --reason "bootstrap"
   pnpm operator:list
   ```

   The first operator names themselves: there are no other operators yet. This is the only exception to the rule that the author must already hold the role.
3. Open `https://<installation address>/operator` and enrol a second factor. Without it the console will not open.

## The author of a command

Every changing command names its author: `--as <id|email>` or the `REMO_OPERATOR` variable. Without an author the command refuses and prints a hint. This covers role changes, money and measures alike: the journal never has a row with a blank author.

The first grant has one exception: when the installation has zero operators and `--as` is the address being granted, the command allows the self-grant. Every later command requires an existing operator.

## Grant and revoke the role

```sh
pnpm operator:grant  --email person@example.com --reason "runs support" --as ops@example.com
pnpm operator:revoke --email person@example.com --reason "left the team" --as ops@example.com
pnpm operator:list
```

- `grant` requires an active account with a confirmed address.
- `revoke` refuses when this is the last operator: otherwise there would be nobody to grant the next role.
- Revoking does not end the account's sessions. The next console request from that account gets 404.
- Both commands write a journal row, `operator.granted` or `operator.revoked`, with the reason and the author.

| Flag | Meaning |
|---|---|
| `--email` | the account that gains or loses the role |
| `--reason` | why; stored in the journal, required |
| `--as` | the author of the command: an operator id or address |
| `REMO_OPERATOR` | the same author when `--as` is omitted |

## Check

- `pnpm operator:list` prints the address, id and grant date; a granted role names its author.
- `/operator` opens under the new account after the second factor is enrolled.
- Under an account without the role, `/operator` answers "Page not found".
- The journal has an `operator.granted` row with your reason.
- A command without `--as` and without `REMO_OPERATOR` refuses before opening the database.

## If access is lost

| What is lost | What to do |
|---|---|
| Password | reset it by letter to the confirmed address; the role stays with the account |
| Authenticator app | sign in with a recovery code; if none are left, [reset the second factor](/guide/operator/totp) from another operator |
| Both the mailbox and the second factor | restore the mailbox. While it is unavailable, another operator performs the reset; if there is none, only the database owner on the server can help, followed by a fresh bootstrap |
| The account is deleted | the role goes with the account; if no operators remain, repeat the bootstrap |

Keep two operators: a single operator who has lost both the mailbox and the app leaves the installation unmanageable. Emergency work in the database writes no journal row, so record the reason in the ticket.

## If something goes wrong

| Message | Cause | What to do |
|---|---|---|
| `has no confirmed address` | the address is not confirmed | confirm it in the app and repeat |
| `is not an instance operator` | `--as` names an account without the role | name an existing operator or use the bootstrap |
| `LAST_OPERATOR` | an attempt to remove the last role | grant the role to a second person first |
| `no account with the address` | the account is not in this installation | register it here; the role does not move between installations |
| `DATABASE_URL is required` | the environment is not loaded | run the command from the release directory with its `.env` |
| `--as ... is required` | the author is missing | add `--as` or `REMO_OPERATOR` |

## Where next

[Console](/guide/operator/console) — how to open `/operator` and what is on the screen.
