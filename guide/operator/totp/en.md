## Why

An operator account opens money, customer data and measures against abuse. A password alone is not enough: a leaked password or mailbox must not give access to the console. That is why an operator must have a second factor: a code from an authenticator app (Yandex Key, Google Authenticator, 1Password, Bitwarden and similar).

An operator without a second factor cannot open the console. Money commands and abuse measures on the server ask for the code too: several people may share one server account. Only granting and revoking the operator role and resetting the factor skip the code — they are how access is restored when the factor is gone.

## Enrolling

1. Open account settings → **Security** → **Two-factor sign-in**.
2. Enter your current password. The password proves it is you and changes nothing else.
3. The server shows a QR code, the key and a link for the phone. Point the app's camera at the QR code — the picture is drawn in the browser and the secret is not sent anywhere. Without a camera, type the key by hand or open the link on the device: the app adds an entry named after the installation. EU and Russian entries have different names and cannot be confused.
4. Enter the six-digit code from the app. The code changes every 30 seconds.
5. Save the **10 recovery codes**. They are shown once; download the file or copy them somewhere safe and tick "I have saved the codes".
6. Done. Every other session of the account ends; the current one stays.

The key and the recovery codes are never shown again. If you did not save the codes, generate new ones in the same section; the old ones stop working at once.

## Signing in

1. Enter the address and password.
2. Enter the code from the app. The "Use a recovery code" link opens a field for a code from the list.
3. Five attempts end the current window: enter the password again to get a fresh one.
4. Ten wrong codes in an hour close code sign-in for an hour. After that you wait; the password alone does not create a session.
5. A code works once. The same code entered again within its 30 seconds is rejected.

A code is accepted with one step of clock tolerance: a phone half a minute behind still works. If codes keep failing, turn on automatic time on the phone and on the server.

## Commands on the server

Money and abuse measures act as the operator named by `--as`, so the command asks for that operator's code:

- in a terminal, interactively after the command starts;
- in a script, with `--code <six digits>`; without a code a non-interactive run refuses.

A recovery code works and is spent. Five wrong codes in a row close this operator's money commands and measures for 15 minutes; the attempts are stored in the database, so restarting the command does not lift the lock and sign-in is not closed. The journal marks the action with the `cli` channel and the `totp` or `recovery` factor.

```sh
pnpm billing:refund <payment-id> --expect-refunded 0 --reason "cancellation" --as ops@example.com --code 123456
```

On a test stand (`REMO_STAGE=1`) the check can be switched off with `REMO_OPERATOR_CLI_MFA=0`, for stand scripts only; a production installation ignores the variable.

## Confirming in the console

- Console reading stays open for 12 hours after a code: Pulse, customer cards, journal.
- A changing action needs a code no older than 15 minutes; when such actions arrive in the console, that is enough for a refund, credit, payment or measure. One code opens both windows: reading for 12 hours and changing for 15 minutes.
- When a window expires, the console asks for a code again and keeps what you had typed.

## Recovery codes

Each code works once. When fewer than three remain, the interface reminds you to generate new ones. New codes are created in the same section with a code from the app: the old ones stop working at once.

A recovery code does not restore the authenticator app. If the device is lost, enrol a new factor right after signing in with a recovery code.

## Losing the device

| What is left | What to do |
|---|---|
| Recovery codes | sign in with one and enrol a new factor |
| Another operator | they reset the factor with a server command |
| Neither | another operator performs the reset; if there is none, restore the mailbox and follow [The first operator](/guide/operator/first-operator) |

Reset from the server:

```sh
pnpm mfa:reset --email person@example.com --reason "phone lost" --as ops@example.com
```

The command removes the secret, every recovery code and every pending sign-in attempt, ends all sessions of the account and writes an `mfa.reset` row with the reason. The next console sign-in asks to enrol the factor again.

There is deliberately no reset by letter: otherwise a stolen mailbox would bypass the protection the factor exists for. Only an operator on the server performs a reset; an operator cannot reset their own factor.

## Turning it off

While the account holds the operator role, the second factor cannot be turned off. Revoke the role with a server command first, then turn the factor off in settings with a code. An account without the role may turn it off.

## Check

- After enrolment, signing in without a code creates no session.
- Entering the same code twice is rejected.
- A code from the neighbouring step (±30 seconds) is accepted, one two steps away is not.
- Settings show "On" with the date; the recovery-code count drops after each use.
- After 12 hours Pulse asks for a code; a changing action in the console 20 minutes later asks for the code again.
- `pnpm billing:refund` without `--code` in a script refuses, and with a wrong code too; after five failures the commands are closed for 15 minutes.
- `pnpm mfa:reset --help` prints the same flags; the command without `--as` and `--reason` refuses.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| "That code did not work" | clocks disagree | turn on automatic time; a recovery code works too |
| "Too many wrong codes" | the hourly limit was reached | wait an hour; sessions are unaffected, but code sign-in is closed |
| `MFA_REQUIRED` in the console | no code was entered or the window expired | enter the code; if no factor exists, enrol one |
| `MFA_UNAVAILABLE` | the encryption key is not configured on the server | that is the installation administrator's job, not the operator's |
| "You cannot turn it off while the account holds the operator role" | the role's protection | revoke the role on the server first |
| Recovery codes are lost | they are shown once | generate new ones with a code, or reset the factor from another operator |
| The command asks for `--code` | it is running without a terminal | pass the code as a flag; in a terminal the command asks for it |
| After a reset the console asks to enrol again | that is expected | enrol the factor and save the new codes |

## Where next

[Account deletion](/guide/operator/account-deletion) — what happens to an account at a person's request.
