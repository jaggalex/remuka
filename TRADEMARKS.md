# Trademark policy

The names **Ремука** and **Remuka**, the wordmark **ремука** / **remuka** and the Ремука logo
belong to the author and copyright holder, Alexander Kostylev.

The source code is licensed under [AGPL-3.0-only](LICENSE). That licence grants rights to
the **code**: to run it, study it, change it and share changes. It does not grant rights to
the **name** or the **mark**. This page explains what a fork may do, so the rule is
followed without a lawyer.

## What a fork may do

- **Run it for yourself or your team.** An unchanged build on your own server may keep the
  name and the logo: you are not offering a service to the public under someone else's
  brand.
- **Change the code and publish the changes** under the AGPL, with the source offer the
  licence requires.
- **Say what it is based on.** «Основано на Ремуке» / "Based on Remuka", with a link to
  <https://github.com/jaggalex/remuka>, is honest and welcome.
- **Use the name to refer to the original product** in a comparison, a review, an article
  or a client integration.

## What a fork may not do

- **Run a public or commercial service under the name «Ремука» or "Remuka"**, or under a
  name confusingly close to it. A derived product needs its own name.
- **Use the Ремука logo, favicon or wordmark** as the identity of your product: in the
  interface, the site, the app icon, mail or marketing.
- **Speak for the project**: imply that your fork is the official build, that the author
  endorses it, or that you provide support on the author's behalf.
- **Register the name or a confusingly similar domain, account or trademark** for your own
  product.

## How to comply in one setting

An installation shows its own name everywhere — interface, mail, exports — when
`REMO_PRODUCT_NAME` is set:

```sh
REMO_PRODUCT_NAME="Acme Boards"
```

Then replace the logo files and the site name with your own, and keep the AGPL source offer
for your users. The internal `remo` code name in package names, `REMO_*` variables,
database roles, headers and the backup format is not a brand and may stay as it is
(ADR-254, `spec/rebrand.md` §2): those names are contracts with existing installations.

The cloud domains `remuka.com`, `remuka.ru`, `app.remuka.com`, `docs.remuka.com` and
`support.remuka.com` belong to the project and are not part of the licence.

## Questions

Write to <hello@remuka.com>. A permission that is not written here is not granted; ask
before relying on it.
