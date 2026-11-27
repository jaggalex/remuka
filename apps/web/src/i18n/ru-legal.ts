/**
 * RU strings for the legal documents: the registration consent, the re-acceptance
 * window, the account «Документы» page and the withdrawal flow (ADR-256 §3, §5–§7).
 *
 * The wording of the two checkboxes follows §3.1: the offer and the personal-data consent
 * are separate active actions, and the policy is a link beside the consent. The product
 * name comes from `@remo/brand` through the i18n interpolation.
 */
export const ruLegal = {
  "legal.changes": "Что изменилось в документе «{document}»",
  "legal.documents": "Документы",

  "legal.doc.offer": "Договор-оферта",
  "legal.doc.consent": "Согласие на обработку персональных данных",
  "legal.doc.privacy": "Политика обработки персональных данных",
  "legal.doc.cookies": "Политика cookie",
  "legal.doc.rules": "Правила использования сервиса",
  "legal.doc.terms": "Условия использования",
  "legal.doc.dpa": "Соглашение об обработке данных",

  "legal.page.title": "Документы",
  "legal.page.intro":
    "Все документы этой установки, действующая редакция и то, что вы приняли. Сами документы открыты всем; для принятия нужен аккаунт.",
  "legal.page.back": "Вернуться на главную",
  "legal.page.loading": "Загружаем документы…",
  "legal.page.failed": "Не удалось загрузить документы. Проверьте связь и попробуйте ещё раз.",
  "legal.page.empty": "Эта установка не публикует юридических документов.",
  "legal.page.guest":
    "Войдите, чтобы видеть, какие документы вы приняли. Сами документы открыты без входа.",
  "legal.page.current": "Редакция {version}",
  "legal.page.effective": "Действует с {date}",
  "legal.page.draft": "Черновик",
  "legal.page.draftNote": "Не опубликован: текст согласуется с юристом.",
  "legal.page.accepted": "Принято {date}",
  "legal.page.notAccepted": "Не принято",
  "legal.page.withdrawn": "Отозвано {date}",
  "legal.page.accept": "Принять",
  "legal.page.withdraw": "Отозвать согласие",
  "legal.page.archive": "Редакции",
  "legal.page.version": "v{version}",
  "legal.page.required": "Обязательный",
  "legal.page.acceptFailed": "Не удалось сохранить принятие. Проверьте связь и попробуйте ещё раз.",
  "legal.page.withdrawFailed": "Не удалось сохранить отзыв. Проверьте связь и попробуйте ещё раз.",

  "legal.consent.group": "Документы для принятия",
  "legal.consent.requiredHint": "Отметьте, чтобы создать аккаунт",
  "legal.consent.draft": "Черновик",
  "legal.consent.offerBefore": "Принимаю ",
  "legal.consent.offerLink": "Пользовательское соглашение (оферту)",
  "legal.consent.offerAfter": "",
  "legal.consent.consentBefore": "Даю ",
  "legal.consent.consentLink": "согласие на обработку персональных данных",
  "legal.consent.consentMiddle": " — имени и почты — на условиях ",
  "legal.consent.privacyLink": "Политики",
  "legal.consent.consentAfter": "",
  "legal.consent.termsBefore": "Принимаю ",
  "legal.consent.termsLink": "Условия использования",
  "legal.consent.termsMiddle": ". Как мы работаем с данными, читайте в ",
  "legal.consent.termsPrivacyLink": "Политике конфиденциальности",
  "legal.consent.termsAfter": ".",
  "legal.consent.genericBefore": "Принимаю ",
  "legal.consent.genericAfter": "",

  "legal.register.requiredTwo":
    "Без двух галочек мы не можем создать аккаунт — так требует закон.",
  "legal.register.requiredOne":
    "Без этой галочки мы не можем создать аккаунт — так требует закон.",
  "legal.register.required": "Отметьте обязательные документы, чтобы создать аккаунт.",
  "legal.register.changed":
    "Документ изменился, пока вы заполняли форму. Сейчас показана действующая редакция — прочитайте и отметьте её снова.",

  "legal.upcoming.title": "Скоро новая редакция: {doc}",
  "legal.upcoming.body": "Она вступает в силу {date}. После этой даты при входе сервис попросит её принять.",
  "legal.upcoming.link": "Прочитать документ",

  "legal.guest.nameBefore": "Имя увидят участники комнаты. ",
  "legal.guest.nameLink": "Документы и политика",
  "legal.guest.nameAfter": ".",

  "legal.reaccept.title": "Документы обновились",
  "legal.reaccept.intro": "Чтобы продолжить, прочитайте и примите действующую редакцию.",
  "legal.reaccept.accept": "Принять",
  "legal.reaccept.signOut": "Выйти",
  "legal.reaccept.backup": "Скачать бэкап комнаты",
  "legal.reaccept.backupFailed": "Не удалось скачать бэкап. Проверьте связь и попробуйте ещё раз.",
  "legal.reaccept.failed": "Не удалось сохранить принятие. Проверьте связь и попробуйте ещё раз.",

  "legal.withdraw.title": "Отозвать согласие?",
  "legal.withdraw.body":
    "Сервис не может работать без обработки имени и e-mail. Отзыв сам по себе ничего не удаляет: удалите аккаунт, и его данные будут удалены в течение 30 дней.",
  "legal.withdraw.confirm": "Отозвать",
  "legal.withdraw.cancel": "Отмена",
  "legal.withdraw.done": "Согласие отозвано.",
  "legal.withdraw.delete": "Удалить аккаунт",
  "legal.withdraw.failed": "Не удалось сохранить отзыв. Проверьте связь и попробуйте ещё раз.",
};
