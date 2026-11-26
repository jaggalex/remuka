/**
 * RU strings — the cookie notice, the consent banner, the settings and the policy page
 * (ADR-255, `spec/cookies.md` §6).
 *
 * The wording of the notice follows §6.1: what the product does with the storage, one
 * button, one link. The category names are the registry's categories, not a second list
 * (§2); a category without a translation here fails the type check.
 */
export const ruConsent = {
  /** §6.1: the one-line notice of the `ru` zone, while only necessary storage exists. */
  "consent.notice": "{product} использует cookie, чтобы вы могли войти и работать в комнатах.",
  "consent.notice.learn": "Подробнее",
  "consent.notice.gotIt": "Понятно",
  /** §3, §6.1: the separate personal-data consent document, only when the operator set it. */
  "consent.notice.personalData": "Согласие на обработку персональных данных",

  /** §6.2: the first screen of the banner, shown when the registry has tracking. */
  "consent.banner.text":
    "Мы используем необходимые cookie для входа и работы в комнатах. С вашего разрешения — аналитику и рекламу, чтобы понимать, как продуктом пользуются.",
  "consent.banner.acceptAll": "Принять всё",
  "consent.banner.rejectAll": "Отклонить всё",
  "consent.banner.customize": "Настроить",

  "consent.settings.title": "Настройки cookie",
  "consent.settings.intro":
    "Выберите, что сервис может хранить в вашем браузере. Необходимое нужно для входа и работы комнат; без него сервис не работает.",
  "consent.settings.save": "Сохранить",
  "consent.settings.cancel": "Отмена",
  "consent.settings.failed": "Не удалось сохранить выбор. Проверьте связь и попробуйте ещё раз.",
  "consent.settings.outdated":
    "Политика cookie изменилась, поэтому старый выбор не сохранён. Мы перечитали его из браузера: проверьте настройки и подтвердите выбор заново.",
  "consent.settings.policy": "Политика cookie",
  "consent.settings.personalData": "Согласие на обработку персональных данных",
  "consent.settings.always": "Всегда включено",
  "consent.settings.gpc":
    "Браузер передаёт Global Privacy Control: необязательные категории отключены.",
  "consent.settings.none":
    "Эта установка не спрашивает согласие: необязательное хранение выключено.",
  "consent.settings.noneOnly":
    "Эта установка использует только необходимые cookie: согласие не спрашивается, переключателей нет.",
  "consent.settings.noChoice":
    "В этой версии нет необязательных cookie: аналитика и реклама не используются, поэтому выбирать нечего. Полный список — в «Политике cookie».",
  "consent.settings.records": "{count} записей",

  "consent.category.necessary": "Необходимые",
  "consent.category.preferences": "Ваши настройки",
  "consent.category.analytics": "Аналитика",
  "consent.category.marketing": "Реклама",
  "consent.category.necessary.hint": "Вход, защита форм, доступ к комнате и ваш выбор cookie.",
  "consent.category.preferences.hint": "Язык, тема и настройки редактора, которые вы выбрали сами.",
  "consent.category.analytics.hint": "Понимать, какими функциями пользуются, чтобы улучшать продукт.",
  "consent.category.marketing.hint": "Показывать рекламу и измерять её результат.",

  /** §6.4: the policy page. It renders the registry, never a hand-kept table. */
  "consent.legal.title": "Политика cookie",
  "consent.legal.intro":
    "Здесь — всё, что этот сервис хранит в вашем браузере: cookie и записи локального хранилища. Список строится из реестра продукта, поэтому в нём нет ничего, чего нет в коде.",
  "consent.legal.edition": "Редакция политики: {version}.",
  "consent.legal.necessaryOnly":
    "Сейчас сервис использует только необходимые cookie и настройки, которые вы выбрали сами. Аналитики и рекламы нет.",
  "consent.legal.columns.name": "Ключ",
  "consent.legal.columns.category": "Категория",
  "consent.legal.columns.lifetime": "Срок",
  "consent.legal.columns.purpose": "Назначение",
  "consent.legal.full": "Полный текст политики",
  "consent.legal.manage": "Настроить cookie",
  "consent.legal.back": "Вернуться на главную",

  /** §6.3: the one name of the entry point in the footers and the policy page. */
  "consent.link": "Cookie",
  "consent.close": "Закрыть",

  /** The registry's lifetimes in words. One row per value in `@remo/consent`. */
  "consent.lifetime.hours48": "48 часов",
  "consent.lifetime.days30": "30 дней",
  "consent.lifetime.hours12": "12 часов",
  "consent.lifetime.year1": "1 год",
  "consent.lifetime.consentChoice": "6 месяцев в ЕС, 12 месяцев в России",
  "consent.lifetime.untilCleared": "до очистки браузера",
  "consent.lifetime.session": "до закрытия вкладки",
};
