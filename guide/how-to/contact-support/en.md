## When you need it

You need to ask a question about the product, report a bug or suggest an idea. This page helps you send a request and know in advance what travels with it and what stays in the room.

## Where to open support

Support opens from four places:

1. **The account menu** → **Help and support**. The entry exists only when you are signed in and support is on for the installation.
2. **The help centre** → **Write to support** in the header of the help pages. The link is shown to a signed-in reader only; the help itself is public.
3. **A plan limit notice** → **Questions about your plan?** It appears where the product refused because of a limit or a paid feature.
4. **A crash screen** → **Report a problem**. It appears when the app could not draw the room; technical information is already ticked there.

No entry means support is off on this installation. The server administrator turns it on; it is not a sign-in fault.

## What always travels

In the built-in chat mode, support receives what it needs to recognise you and your plan:

- the name and email address from your profile;
- the organisation's name and its plan;
- the interface language, the app version and build, the installation's region;
- a separate request number — it is not your account id and exists only for support.

This goes to the support server, not into the room.

## What travels with your consent

Above the chat there is a box, **Attach technical information**. It is unticked by default. When you tick it, the request gains:

- the app version and build, the browser and the operating system;
- the interface language and the window size;
- the room id and your role in it — without the room's name;
- the last 20 client errors: the message and the time;
- the connection state the save line shows.

You can clear the box at any time: the request stays, the technical information no longer belongs to it. Error text is what makes "it does not save" and "a blank screen" answerable without asking you to open the browser console.

## What never travels

- Room content: cards, sticky notes, tables, comments, files.
- Names of rooms, organisations and members.
- Your password, codes from letters, card details. Support never asks for them: if a letter or a message asks, do not answer it.
- Other tabs and files on your computer.

If a room is needed to understand the problem, support will ask for a link or a fragment. Whether to share them is your choice.

## When a reply comes

In the built-in chat mode, an AI assistant takes the first line: it answers at once, without waiting for working hours, and links the help centre and this guide. Questions about money, account security or lost data, and requests for a person, go straight to a person.

A person replies during support working hours. The installation's administrator sets the working hours, and the panel shows the exact waiting text. The default is "A person will reply within a working day". The reply arrives in the support chat, and if email is connected on the installation, also in your mailbox, so you can close the panel.

## If support or email is off

On a self-hosted installation support is off by default: there is no entry in the menu, and requests go nowhere. That is the normal state of the installation.

- Check [known issues](/guide/support/known-issues) and [troubleshooting](/guide/support/troubleshooting): the answer may already be there.
- Describe a reproducible bug in the [repository issues](https://github.com/jaggalex/remuka/issues).
- If you are the administrator, turn support on for the installation. `link` mode opens your page or a `mailto:` address in a new tab: it suits an installation with only a mailbox or an external form. `chatwoot` mode shows the built-in chat. While support is off, the other settings are not needed.

Without email on the installation there is no **Forgot password?** link and no address-confirmation letters; the server administrator changes the password, and an invitation travels as a link. See [Account, organisation and team](/guide/how-to/account).

## Security incident

Do not open a public issue, and do not describe a vulnerability in the support chat before it is fixed. Send a private report through the repository's **Security** tab: **Report a vulnerability** ([github.com/jaggalex/remuka/security](https://github.com/jaggalex/remuka/security)).

Include the version or commit, how the installation is deployed (self-host, reverse proxy, database), steps to reproduce and what an attacker can read or change. The project aims to acknowledge a report within 72 hours.

If the problem is in your proxy, TLS or database rather than in the product, contact the installation operator: the deployment configuration is outside the report's scope. If you suspect someone else signed in, change your password: that ends all sessions.

## Checking

- **Help and support** in the account menu opens the chat panel or an external page.
- **Attach technical information** is unticked until you tick it.
- A sent message appears in the chat, and the reply arrives there.
- If the menu has no entry, support is off: that is expected on a self-hosted installation.

## Where to go next

[Known issues](/guide/support/known-issues) — limitations that are not defects.

[Troubleshooting](/guide/support/troubleshooting) — typical symptoms and what to check.
