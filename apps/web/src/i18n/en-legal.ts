/**
 * EN strings for the legal documents: the registration consent, the re-acceptance
 * window, the account «Documents» page and the withdrawal flow (ADR-256 §3, §5–§7).
 *
 * A translation of `ru-legal.ts`, key for key; the type check compares the two tables.
 * Document titles are here too, so a known document never appears under its file name.
 */
export const enLegal = {
  "legal.documents": "Documents",

  "legal.doc.offer": "Offer agreement",
  "legal.doc.consent": "Personal data processing consent",
  "legal.doc.privacy": "Privacy Policy",
  "legal.doc.cookies": "Cookie Policy",
  "legal.doc.rules": "Acceptable Use",
  "legal.doc.terms": "Terms of Service",
  "legal.doc.dpa": "Data Processing Agreement",

  "legal.page.title": "Documents",
  "legal.page.intro":
    "Every document this installation publishes, the revision in force and what you have accepted. The documents themselves are public; accepting one requires an account.",
  "legal.page.back": "Back to home",
  "legal.page.loading": "Loading documents…",
  "legal.page.failed": "The documents could not be loaded. Check the connection and try again.",
  "legal.page.empty": "This installation publishes no legal documents.",
  "legal.page.guest":
    "Sign in to see which documents you have accepted. The documents themselves are public.",
  "legal.page.current": "Revision {version}",
  "legal.page.effective": "Effective {date}",
  "legal.page.draft": "Draft",
  "legal.page.draftNote": "Not published: the text is under legal review.",
  "legal.page.accepted": "Accepted {date}",
  "legal.page.notAccepted": "Not accepted",
  "legal.page.withdrawn": "Withdrawn {date}",
  "legal.page.accept": "Accept",
  "legal.page.withdraw": "Withdraw consent",
  "legal.page.archive": "Revisions",
  "legal.page.version": "v{version}",
  "legal.page.required": "Required",
  "legal.page.acceptFailed": "The acceptance could not be saved. Check the connection and try again.",
  "legal.page.withdrawFailed": "The withdrawal could not be saved. Check the connection and try again.",

  "legal.consent.group": "Documents to accept",
  "legal.consent.requiredHint": "Tick to create an account",
  "legal.consent.draft": "Draft",
  "legal.consent.offerBefore": "I accept the ",
  "legal.consent.offerLink": "user agreement (offer)",
  "legal.consent.offerAfter": ".",
  "legal.consent.consentBefore": "I give ",
  "legal.consent.consentLink": "consent to the processing of personal data",
  "legal.consent.consentMiddle": " — name and email — under the ",
  "legal.consent.privacyLink": "Privacy Policy",
  "legal.consent.consentAfter": ".",
  "legal.consent.termsBefore": "I accept the ",
  "legal.consent.termsLink": "Terms of Service",
  "legal.consent.termsMiddle": " and the ",
  "legal.consent.termsAfter": ".",
  "legal.consent.genericBefore": "I accept the ",
  "legal.consent.genericAfter": "",

  "legal.register.requiredTwo":
    "We can't create an account without both boxes — the law asks for it.",
  "legal.register.requiredOne":
    "We can't create an account without this box — the law asks for it.",
  "legal.register.required": "Tick the required documents to create an account.",
  "legal.register.changed":
    "A document changed while you were filling in the form. The current revision is shown now — read it and tick it again.",

  "legal.upcoming.title": "A new revision is coming: {doc}",
  "legal.upcoming.body": "It takes effect on {date}. After that date signing in will ask you to accept it.",
  "legal.upcoming.link": "Read the document",

  "legal.guest.nameBefore": "The people in this room will see your name. ",
  "legal.guest.nameLink": "Documents and policy",
  "legal.guest.nameAfter": ".",

  "legal.reaccept.title": "Documents have been updated",
  "legal.reaccept.intro": "To continue, read and accept the current revision.",
  "legal.reaccept.accept": "Accept",
  "legal.reaccept.signOut": "Sign out",
  "legal.reaccept.backup": "Download room backup",
  "legal.reaccept.backupFailed": "The backup could not be downloaded. Check the connection and try again.",
  "legal.reaccept.failed": "The acceptance could not be saved. Check the connection and try again.",

  "legal.withdraw.title": "Withdraw consent?",
  "legal.withdraw.body":
    "The service cannot work without processing your name and e-mail. Withdrawing consent does not delete anything by itself: delete your account and its data will be erased within 30 days.",
  "legal.withdraw.confirm": "Withdraw",
  "legal.withdraw.cancel": "Cancel",
  "legal.withdraw.done": "Consent withdrawn.",
  "legal.withdraw.delete": "Delete account",
  "legal.withdraw.failed": "The withdrawal could not be saved. Check the connection and try again.",
};
