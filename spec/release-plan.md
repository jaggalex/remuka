# План релиза 0.5: состояние, решения, следующий шаг

Документ для передачи между сессиями. Код — источник правды, здесь только то, что из кода
не видно: порядок работ, принятые решения и незакрытые долги. Обновлять при закрытии фазы.

## Ветка и коммиты

`release/0.5` от `main` (`3565ff5`), не запушена. Каждый коммит проходит `pnpm verify`.

| Коммит | Что закрыто |
|---|---|
| `5874f6e` | ADR-246…251 и шесть ТЗ как `proposed` |
| `e080617` | R0: ADR-246 accepted, правки непринятых ТЗ, индекс docs, `state:write` |
| `d039a15` | Почта: схема 21, outbox, 4 драйвера, шаблоны, дренаж, `mail:test`/`mail:dead` |
| `ee491a2` | Сброс пароля: токены, `forgot`/`reset`, отзыв сессий |
| `94140d6` | Верификация адреса, `resend`, приглашения письмом |
| `265622d` | Почта: UI, help/guide, 3 e2e-сценария, эталоны |
| `ad442a9` | Чужая работа: ADR-252 + `spec/rich-text.md` (принята отдельно) |
| `0d321f1` | Биллинг: схема 22, каталог, `entitlementsFor`, `seatUsage`, RLS |
| `c79b6a0` | Лимиты и `402` во всех точках, заморозка, `billing:grant`/`prices` |
| `6056b01` | Деньги, счета, кредит, промокоды, каталог, подключения, checkout, `mark-paid` |
| `40c4614` | ЮKassa, вебхуки, 9 писем (схема 23) |
| `5a58269` | Продление, сохранённый способ оплаты, грейс |
| `2881b7a` | Изображения: схема 24, `files`, disk/S3, `sharp`, очередь |

## Поезд версий

| Версия | Содержание | Статус |
|---|---|---|
| 0.5.0 | Почта | **готово** |
| 0.6.0 | Изображения (R5) | начато: хранилище; HTTP и холст впереди |
| 0.7.0 | Биллинг: права, счета, счёт | **сервер готов**, UI и e2e нет |
| 0.8.0 | Платежи: ЮKassa и продление | сервер готов, цикл не запущен |
| 0.9.0 | Поддержка (R6) | не начато |
| 0.10.0 | AI-шлюз (R7) | не начато |

## Нумерация схем (зафиксирована)

21 почта · 22 биллинг и подключения · 23 биллинговые письма · 24 файлы · 25 поддержка
(`users.support_id`) · 26 шлюз (`ai_runs.gateway_provider`).

ADR-249/250/251 сдвинуты на 24/25/26 **до принятия** и остаются `proposed`. Принятие — в
первом PR своей фазы, как у ADR-246.

## Решения владельца, принятые по ходу

- Релиз — поезд версий, а не один 0.5.0 со всеми модулями.
- Непринятые ADR/ТЗ можно править до `accepted`, отдельным коммитом.
- Почта: требование подтверждения для приглашений включено; `console` только вне production;
  SMTP — только 465/587 без query-параметров.
- Биллинг: `--plan free` = отмена подписки; заморозка = `read + export + backup`, архив =
  `read`; публичная ссылка экспорт не получает; `orgs.read_only_at` — вход в `effective()`.
- **Первый переход `REMO_BILLING=off → on` отзывает** у Free-организаций роли выше базовых и
  защищённые ссылки, с аудитом и уведомлением (не грандфазеринг).
- Удаления организации в v1 нет — только архив; денежные таблицы `on delete restrict`.
- Изображения: бэкап — в уже зарезервированный `assets`, версия формата 3; `aspectLocked` —
  признак `KindSpec`, а не переопределение `Shift`.
- Поддержка: `/api/support/*`, конфиг клиенту через `GET /api/support/config`; до биллинга
  поля контекста `null`.
- Шлюз: HTTPS с закреплённым сертификатом на WireGuard, не `http://`.

## Незакрытые долги (важно)

Состояние на 23.11.2026. Код 0.5–0.8 закрыт: operator, actions, stage, TOTP и Pulse
(этапы 1–4) есть в дереве, `SCHEMA_VERSION = 38` (`apps/sync/schema-version.mjs`), прогон
`pnpm verify --e2e` зелёный. Ранние пункты этого раздела — цикл продления, биллинг-UI,
изображения R5.3–R5.6, «шов» в `BoardApp.tsx` и эталоны — закрыты кодом и здесь не
повторяются. Осталось только внешнее:

1. **Выкладка 0.8.0.** Схема 20 → 38, порядок EU → RU, окружение и проверки —
   `docs/operations/cloud.md`, раздел Releases. Живого прогона не было.
2. **Юридические тексты.** В `content/legal/index.json` обязательные документы
   `eu/terms`, `ru/offer` и `ru/consent` — черновики. С `REMO_COMPLIANCE_ZONE=eu`/`ru`
   production не стартует, пока они не опубликованы; `REMO_LEGAL_ALLOW_DRAFTS=1` — только
   стенд вместе с `REMO_STAGE=1`.
3. **Chatwoot.** Поддержка этапов 2–3 R6: сам сервис, `remo-support-agent` и почтовый канал
   живут вне этого дерева; нужен стенд с `REMO_SUPPORT_PROVIDER=chatwoot` и эталон панели.
4. **Ключи ЮKassa.** Боевой магазин, ключи через оператора (не в git),
   `REMO_YOOKASSA_WEBHOOK_IPS` из опубликованного списка и проверка
   `create → verify → activate → smoke` на тестовом подключении.
5. **DNS почты.** SPF, DKIM и DMARC для `mail.remuka.com`; провайдер российского региона
   (Yandex Cloud Postbox или Unisender Go) и `pnpm mail:test` на оба ящика.
6. **Приёмка на стенде.** `docs/operations/stage.md`, часть B: две установки `stage-ru` и
   `stage-eu`, `REMO_STAGE=1`, затем протокол `spec/rebrand-acceptance.md` §9.
7. **Pulse, этап 5.** `site-stats.mjs` и `site_daily`, дневной счётчик `site.visits` в
   `metrics_daily` (`spec/pulse.md` §8.5) — кода нет. Этапы 1–4 закрыты.

## Команды и ворота

```
pnpm test:db:up          # отдельная тестовая БД, никогда DATABASE_URL
pnpm verify              # типы, линт, тесты, сборка, docs, guide, DS
pnpm verify --e2e        # + 256 браузерных сценариев и Linux-эталоны
pnpm state:write         # после смены схемы/числа ADR/сценариев
node scripts/file-size-check.mjs
```

Ключи оператора: `billing:prices seed|add|publish|check`, `billing:grant`, `billing:mark-paid`,
`billing:providers`, `mail:test`, `mail:dead`.

## Новые переменные окружения

`REMO_MAIL_DRIVER|FROM|REPLY_TO|PRODUCT_NAME|CONSOLE_FILE|BATCH`, `REMO_RESEND_API_KEY`,
`REMO_SMTP_URL`, `REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES`, `REMO_APP_ORIGIN` (уже была),
`REMO_BILLING`, `REMO_BILLING_CURRENCIES`, `REMO_YOOKASSA_WEBHOOK_IPS`,
`REMO_FILES_DRIVER|DIR|MAX_BYTES|MAX_PIXELS|PER_ROOM|CONCURRENCY`, `REMO_S3_*`.

## Что проверить перед продолжением

- `git status` чист, `pnpm verify` зелёный, тестовая БД поднята.
- Схема в `AGENTS.md`/`TESTING.md` совпадает с `SCHEMA_VERSION` (сейчас 38).
- Незакоммиченные чужие файлы не удалять: рабочее дерево может делить другая сессия.

## Мелкие долги после R6.1

- Тема справки `account.support` привязана к `guide/support/known-issues`: отдельной страницы
  «как связаться» в гайде нет. Добавить `guide/how-to/contact-support` и переназначить
  `guide/help-links.json`.
- Эталон панели поддержки не снят: нужен Linux-браузер с `REMO_SUPPORT_PROVIDER=chatwoot`.
- Этапы 2–3 R6 (Chatwoot, `remo-support-agent`, почтовый канал) — инфраструктура и отдельный
  репозиторий, не код этого дерева.

## R7: что осталось

- `@remo/outbound` не отдаёт заголовки ответа, поэтому `X-Remo-Gateway-Provider` пока не
  читается: в `ai_runs.gateway_provider` пишется отправленный upstream (id или BYOK baseUrl).
  Добавить `headers` в результат `safeFetch` и брать значение из ответа.
- `REMO_AI_GATEWAY_CA` не подключён: в `safeFetch` нет опции `ca`. Либо правка пакета,
  либо `NODE_EXTRA_CA_CERTS` в деплое; решить на этапе развёртывания.
- Деплой: WireGuard, nftables, compose/systemd, `guide/admin/deploy`, алерты.
- `agents.<домен>`: отдельный server в nginx, метка `source=agent`, документация.
- Сквозной e2e: sync + шлюз + поддельный провайдер (`docker-compose.test.yml`).

## R9: ребрендинг (ADR-254, `spec/rebrand.md`)

Принято в работу 22.11 после выпуска 0.8.0. Порядок: этап 1 (пакет `@remo/brand`,
`REMO_PRODUCT_NAME`, `about`, ADR-254 → accepted) → этап 2 (интерфейс, письма, экспорт,
бэкапы) → этап 3 (алиасы origin, `4001 moved`, переезд) → этап 4 (документация и
`TRADEMARKS.md`) → этап 5 (`pnpm brand:check` в `pnpm verify`) → runbook переезда.

Инфраструктура (DNS, TLS, Resend, ящики, переименование репозитория, ФИПС) — на владельце,
вне кода. Открытые вопросы: регион РФ и `app.remuka.ru`, `remuka.com/ru`, статус-страница.
