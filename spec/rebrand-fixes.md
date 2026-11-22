# Ребрендинг: доработки после приёмки

ТЗ к **ADR-254**, дополняет `spec/rebrand.md`. Статус: предложено, 2026-11-22. Основание:
приёмка этапов 1–5 от 2026-11-22. Прежде чем менять код, прочитайте `AGENTS.md`, ADR-254 и
`spec/rebrand.md` §§3, 5, 6, 8.

Пункты 1–5 **блокируют переезд** (этап 6 `spec/rebrand.md`). Пункты 6–9 можно сделать
после него. Каждый пункт — отдельный коммит с тестом.

## 0. Что уже принято и не меняется

`@remo/brand`, `REMO_PRODUCT_NAME` и синоним, `/config`, `REMO_APP_ORIGIN_ALIASES`,
`REMO_APP_ORIGIN_MOVED`, закрытие `4001 moved`, карта старого хоста в
`deploy/nginx-remo.conf`, `TRADEMARKS.md`, README, CHANGELOG. Внутренние имена `remo`
(`spec/rebrand.md` §2) не трогать.

## 1. Баннер о предстоящем переезде (блокирует)

**Проблема.** Cookie привязаны к хосту, поэтому в день переезда все пользователи выйдут из
аккаунта без предупреждения. `spec/rebrand.md` §6 требует предупредить за 7 дней.

**Решение.**

- Две новые необязательные переменные сервиса:
  - `REMO_APP_MOVE_TO` — новый адрес, например `https://app.remuka.com`;
  - `REMO_APP_MOVE_AT` — дата переезда, ISO `YYYY-MM-DD`.
- Если обе заданы и корректны, `GET /config` (`apps/sync/public-api.mjs`) дополнительно
  отдаёт `move: { to, at }`. Если нет или значение некорректно — поля `move` нет, а сервис
  пишет одно предупреждение в лог при старте. `/config` по-прежнему не отдаёт ничего,
  кроме брендинга и этой строки.
- Клиент показывает баннер, когда `move` есть и до `at` осталось от 0 до 7 дней
  включительно. Раньше — не показывает. После `at` — тоже нет: старый хост к этому времени
  отвечает 301.
- Баннер строится на существующем механизме уведомлений главной страницы (как
  `verifyBanner` в `HomeMail.tsx`) и виден на главной и в комнате.
- Тексты в i18n, с датой в формате языка интерфейса:
  - ru: «{product} переезжает на {host} {date}. После переезда войдите заново — комнаты и
    данные останутся на месте.»;
  - en: «{product} is moving to {host} on {date}. Sign in again after the move — your rooms
    and data stay where they are.»
- Баннер можно закрыть. Закрытие помнится до конца сессии браузера (`sessionStorage`,
  ключ `remo.moveBanner.dismissed` — кодовое имя, `spec/rebrand.md` §2).
- `deploy/production.env.example` и `docs/self-hosting.md`: обе переменные, с примером и
  одной строкой «зачем».

**Тесты.** `/config` с обеими переменными, с одной, с некорректной датой. Функция «показывать
ли баннер» — чистая, тесты для −8, −7, 0 и +1 дня. Тексты RU и EN с `REMO_PRODUCT_NAME` и
без.

## 2. Установка РФ на `app.remuka.ru` (блокирует)

**Было в этом пункте:** статическая заглушка. **Решение владельца от 2026-11-22:** сервер РФ —
отдельная установка со своей базой, без проксирования (`spec/rebrand.md` §5.1). Поэтому
`app.remuka.ru` — не заглушка, а приложение.

**Сейчас.** `app.remuka.ru` отвечает 308 на `remuka.ru`, а `remuka.ru` показывает
приложение 0.4.1.

**Решение.**

- `app.remuka.ru` отдаёт приложение установки РФ. `REMO_APP_ORIGIN=https://app.remuka.ru`,
  `REMO_DOCS_ORIGIN=https://docs.remuka.ru` в `production.env` сервера РФ.
- `remuka.ru` — сайт. Пока его нет — **302** на `https://app.remuka.ru`.
- `www.remuka.ru` — 301 на `remuka.ru`. `api.remuka.ru` — DNS-запись удалить.
- `BRAND.domains` (`packages/brand`) дополняется полями `appRu`, `docsRu`; `siteRu` уже есть.
  Ссылка «на сайт» в интерфейсе выбирается по `REMO_APP_ORIGIN` установки: `app.remuka.ru` →
  `remuka.ru`, иначе — `remuka.com`. Тест на обе установки.
- Гайд на `docs.remuka.ru` получает `<link rel="canonical">` на `docs.remuka.com`.
- `REMO_COMPLIANCE_ZONE=ru` (ADR-255).
- `remo.letii.ru` по-прежнему ведёт **в установку ЕС**: там живут все старые аккаунты.

**Проверка.** `node scripts/accept-rebrand.mjs`: `app.remuka.ru` отвечает 200, заголовок
«Ремука», `/api/health` новой версии; переадресации в ЕС нет.

## 3. Вернуть смысл строки `support.technicalGranted` (блокирует)

**Проблема.** Было: «Передаётся только в чат поддержки. На серверы remo эти данные не
уходят». Стало: «…Данные не уходят за пределы сервиса». Это другое обещание. Оно неверно,
когда чат поддержки ведёт отдельный оператор (ADR-250): данные как раз уходят в Chatwoot.

**Решение.** Вернуть исходный смысл без имени продукта:

- ru: «Передаётся только в чат поддержки и не сохраняется в комнатах и на серверах приложения.»
- en: “Sent only to the support chat. It is not stored in your rooms or on the application's servers.”

Если строка в `spec/support.md` описана иначе — привести строку к ТЗ, а не наоборот.

**Правило для исполнителя.** Переписывая фразу, чтобы убрать имя, не меняйте её смысл. Это
особенно касается фраз о данных, деньгах и доступе. Если смысл без имени не передаётся,
используйте `{product}`.

**Проверка.** Пройдите все строки i18n, изменённые в ребрендинге
(`git diff main -- apps/web/src/i18n`). Для каждой фразы о данных, доступе, оплате или
безопасности сравните смысл с прежним и перечислите их в описании коммита.

## 4. `brand:check` в объёме ТЗ (блокирует)

**Проблема.** Проверка уже, чем `spec/rebrand.md` §8:

- `letii.ru` ищется только в видимых файлах, а не во всём репозитории;
- правила 3 нет;
- не читаются `apps/web/src/**/*.ts` (не `.tsx`) и файлы `apps/sync`, кроме шаблонов писем.

Поэтому она пропустила старый адрес репозитория в `about.ts` (пункт 5).

**Решение** — дополнить `scripts/brand-check.mjs`, не переписывая его:

1. **Старый хост — везде.** `letii.ru` ищется во всех файлах, которые отслеживает git
   (`git ls-files`; если git недоступен — тот же обход с `SKIP_DIRS`). Исключения списком
   `FILE_ALLOWANCES`, у каждого «почему»:
   - `deploy/nginx-remo.conf` — карта старого хоста;
   - `deploy/*.example` — только строки с `REMO_APP_ORIGIN_ALIASES`;
   - `spec/**`, `ADR.md`, `CHANGELOG*`, `guide/support/changelog/**`;
   - тесты `*.test.*` — проверяют переезд со старого адреса;
   - сам `scripts/brand-check.mjs`.
2. **Старое имя — в коде клиента и сервиса.** К `SURFACES` добавить
   `apps/web/src/**/*.ts` (кроме `*.test.ts` и `*.generated.ts`) и `apps/sync/**/*.mjs`
   (кроме тестов). Читаются только строковые литералы, как уже сделано для i18n.
   Идентификаторы из `IDENTIFIERS` разрешены. Тип данных `remo/fragment` в `clipboard.ts` —
   кодовое имя, добавить его в `IDENTIFIERS`.
3. **Правило 3: бренд только из модуля.** Литералы `"Ремука"`, `"Remuka"`, `remuka.com`,
   `remuka.ru`, `github.com/jaggalex/remuka` в `apps/**` и `scripts/**` (кроме тестов и
   `scripts/brand-check.mjs`) — ошибка с подсказкой «возьмите из `@remo/brand`». В i18n,
   документации, README, `TRADEMARKS.md`, `deploy/**` и `packages/brand/**` — разрешено.
4. Новые случаи — в `scripts/brand-check.test.mjs`: файл-фикстура на каждое правило,
   красный и зелёный.

**Приёмка.** `node scripts/brand-check.mjs` до исправления пункта 5 падает на `about.ts`,
после — зелёный.

## 5. Адрес репозитория — из `@remo/brand` (блокирует)

**Проблема.** `apps/web/src/about.ts` ведёт на `https://github.com/jaggalex/remo`, а
`scripts/guide-build.mjs` — на `jaggalex/remuka`. Ссылку видно на странице «О программе».
В `BRAND` нет поля для репозитория.

**Решение.**

- Добавить в `BRAND` поле `source: "https://github.com/jaggalex/remuka"` и тип в
  `index.d.ts`.
- `about.ts`, `scripts/guide-build.mjs` и остальные места, которые найдёт пункт 4.3, берут
  адрес оттуда.
- Тест в `packages/brand`: `source` — https-адрес на `github.com`.

## 6. Тема справки `about.remuka` (после переезда)

`spec/rebrand.md` §4.1: тема `about.remo` переименовывается в `about.remuka`, старый slug
переадресуется.

- `content/help/about.remo` → `content/help/about.remuka`; пересобрать
  `help/topics.generated.ts` и `generated.json`.
- `HelpPage.tsx`, `parsePath()`: slug `about.remo` открывает `about.remuka` и заменяет
  адрес через `history.replaceState`. Это единственный псевдоним; держать его в одной
  таблице `HELP_TOPIC_ALIASES`.
- Ссылки в `OrganisationDialog.tsx`, `HelpPage.tsx` и тестах — на `about.remuka`.
- Из `IDENTIFIERS` в `brand:check` убрать `about.remo`, оставив только таблицу псевдонимов
  как исключение.

## 7. Контакт для сообщений об уязвимостях (после переезда)

- `SECURITY.md`: кроме формы GitHub — адрес `security@remuka.com`.
- `apps/web/public/.well-known/security.txt` по RFC 9116: `Contact: mailto:security@remuka.com`,
  `Contact:` со ссылкой на форму GitHub, `Expires:` через год, `Preferred-Languages: ru, en`,
  `Canonical: https://app.remuka.com/.well-known/security.txt`.
- Убедиться, что nginx отдаёт `/.well-known/` из статики и в старом хосте, и в новом.

## 8. Безопасный переход по `4001 moved` (после переезда)

**Проблема.** `movedUrl` проверяет только схему `http(s)`. Любой адрес из причины закрытия
сокета уведёт страницу. Кроме того, `onMoved` в `useBoardSession.ts` вызывает
`new URL(target)` без `try` и падает на некорректном адресе.

**Решение.**

- Клиент переходит только на origin, совпадающий с `move.to` из `/config` (пункт 1) или с
  origin из `BRAND.domains.app`. Иначе — показывает `sync.movedUnknown` и никуда не уходит.
- Разбор адреса в `onMoved` — через `movedUrl`, без отдельного `new URL`.
- Тесты: чужой origin, некорректная строка, `javascript:`, совпадающий origin с путём (путь
  заменяется текущим).

## 9. Склонение бренда в i18n (по желанию)

Сейчас везде «в сервисе {product}». Это грамматически верно, но читается суше, чем «в
Ремуке». Решение по `spec/rebrand.md` §4.3: для строк, где имя стоит не в именительном
падеже, завести параметр `{productIn}` (и другие падежи по мере надобности) из
`brandNameCase`. Когда задан `REMO_PRODUCT_NAME`, `{productIn}` подставляет
«в сервисе {имя}». Делать, только если владелец подтвердит; на запуск не влияет.

## 10. Приёмка доработок

- [ ] `pnpm verify` зелёный, включая базовые наборы (`pnpm test:db:up`).
- [ ] С `REMO_APP_MOVE_TO` и `REMO_APP_MOVE_AT` через 5 дней баннер виден на главной и в
      комнате на RU и EN; через 8 дней — нет; после закрытия не появляется до новой сессии.
- [ ] `/config` без новых переменных отвечает как раньше: `{ "productName": null }`.
- [ ] `app.remuka.ru` открывает приложение установки РФ, без переадресации в ЕС.
- [ ] Строка `support.technicalGranted` в RU и EN совпадает по смыслу с исходной; список
      проверенных фраз о данных — в описании коммита.
- [ ] `brand:check` падает на фикстурах каждого нового правила и зелёный на репозитории.
- [ ] На странице «О программе» ссылка на исходный код — `github.com/jaggalex/remuka`.
- [ ] `/help/ru/about.remo` открывает тему «О программе», адрес меняется на `about.remuka`.
- [ ] `/.well-known/security.txt` отдаётся и проходит проверку формата RFC 9116.
- [ ] Закрытие `4001` с чужим origin не уводит страницу.
