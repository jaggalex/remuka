/**
 * EN strings — the cookie notice, the consent banner, the settings and the policy page
 * (ADR-255, `spec/cookies.md` §6).
 *
 * A translation of `ru-consent.ts`, key for key; the type check compares the two tables.
 */
export const enConsent = {
  "consent.notice": "{product} uses cookies to keep you signed in and your rooms working.",
  "consent.notice.learn": "Learn more",
  "consent.notice.gotIt": "Got it",
  "consent.notice.personalData": "Personal data processing consent",

  "consent.banner.text":
    "We use necessary cookies to keep you signed in and your rooms working. With your permission, we also use analytics and marketing to understand how the product is used.",
  "consent.banner.acceptAll": "Accept all",
  "consent.banner.rejectAll": "Reject all",
  "consent.banner.customize": "Customize",

  "consent.settings.title": "Cookie settings",
  "consent.settings.intro":
    "Choose what this service may keep in your browser. Necessary storage keeps you signed in and your rooms working; without it the service cannot run.",
  "consent.settings.save": "Save",
  "consent.settings.cancel": "Cancel",
  "consent.settings.failed": "Your choice could not be saved. Check the connection and try again.",
  "consent.settings.outdated":
    "The cookie policy changed, so the old choice was not saved. We re-read it from your browser: check the settings and confirm your choice again.",
  "consent.settings.policy": "Cookie policy",
  "consent.settings.personalData": "Personal data processing consent",
  "consent.settings.always": "Always on",
  "consent.settings.gpc":
    "Your browser sends Global Privacy Control: optional categories are turned off.",
  "consent.settings.none":
    "This installation does not ask for consent: optional storage stays off.",
  "consent.settings.noneOnly":
    "This installation uses only necessary cookies: no consent is asked and there are no switches.",
  "consent.settings.noChoice":
    "This build has no optional cookies: it uses no analytics and no marketing, so there is nothing to choose. The full list is in the cookie policy.",
  "consent.settings.records": "{count} records",

  "consent.category.necessary": "Necessary",
  "consent.category.preferences": "Your settings",
  "consent.category.analytics": "Analytics",
  "consent.category.marketing": "Marketing",
  "consent.category.necessary.hint":
    "Signing in, form protection, room access and your cookie choice.",
  "consent.category.preferences.hint": "Language, theme and editor settings you chose yourself.",
  "consent.category.analytics.hint":
    "Understanding which features are used, so the product can be improved.",
  "consent.category.marketing.hint": "Showing advertising and measuring its result.",

  "consent.legal.title": "Cookie policy",
  "consent.legal.intro":
    "Everything this service keeps in your browser: cookies and local storage. The list is built from the product's registry, so it contains nothing that is not in the code.",
  "consent.legal.edition": "Policy edition: {version}.",
  "consent.legal.necessaryOnly":
    "The service currently uses only necessary cookies and the settings you chose yourself. There is no analytics or advertising.",
  "consent.legal.columns.name": "Key",
  "consent.legal.columns.category": "Category",
  "consent.legal.columns.lifetime": "Lifetime",
  "consent.legal.columns.purpose": "Purpose",
  "consent.legal.full": "Full policy text",
  "consent.legal.manage": "Manage cookies",
  "consent.legal.back": "Back to the home page",

  "consent.link": "Cookies",
  "consent.close": "Close",

  "consent.lifetime.days30": "30 days",
  "consent.lifetime.hours12": "12 hours",
  "consent.lifetime.year1": "1 year",
  "consent.lifetime.consentChoice": "6 months in the EU, 12 months in Russia",
  "consent.lifetime.untilCleared": "until you clear the browser",
  "consent.lifetime.session": "until the tab closes",
};
