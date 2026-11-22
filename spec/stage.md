# Тестовый стенд: две зоны на одной машине

ADR-261. Статус: 2026-11-23. Связано: `spec/cloud-zones.md`, `spec/ui-acceptance.md`,
`spec/legal-acceptance.md`, `spec/payment-providers.md`.

**Статус работ.** Часть A сделана 2026-11-23: параметризация установки (§3) —
`deploy/config.sh`, `release.sh`, `remo`, `bootstrap.sh`, шаблоны `remo-backup@`, — сервер
стенда `deploy/stage/*`, инструкция `docs/operations/stage.md` и пункты 1 и 4 порядка
работ (§7). Часть B сделана 2026-11-23: флаг `REMO_STAGE=1` (§5), `stage:seed` и
`stage:reset` (§6), схема 38 (состояние `suppressed` у письма). Осталось живое: приёмка §8
на выложенном стенде и выкладка обоих экземпляров (§7.5). Решение ADR-261 не менялось.

## 0. Зачем

Приёмку через интерфейс (`spec/ui-acceptance.md`) нельзя проходить на проде: сценарии создают
аккаунты, платежи, жалобы и удаляют данные. Нужен стенд, который повторяет облако — **две
установки, `ru` и `eu`, работающие одновременно**, — закрыт от посторонних и не может
навредить проду: написать настоящему человеку, списать настоящие деньги, попасть в поиск.

Сейчас второй экземпляр на одной машине поставить нельзя: `deploy/release.sh` и `deploy/remo`
пишут в `/srv/remo`, compose-проект называется `remo`, у веб-контейнера фиксированный алиас
`remo-web` в общей сети прокси, `db-tools` ходит в базу `remo` пользователем `remo`. Это ТЗ
делает установку параметризуемой и описывает сам стенд.

## 1. Решения

1. **Отдельная VPS стенда**, на ней два экземпляра: `stage-ru` и `stage-eu`. Прод и стенд не
   делят машину, базу и сеть. Параметризация (§3) не запрещает поставить экземпляр стенда и
   на прод-сервер, но так не делаем: ошибка на стенде не должна задевать клиентов.
2. **Своя база на каждый экземпляр — отдельный контейнер PostgreSQL**, не отдельная база в
   общем кластере. Причина: роль `remo_app` зашита в `apps/sync/schema.sql` (гранты функциям),
   а роли в PostgreSQL общие на кластер. В одном кластере приложение `stage-ru` могло бы
   подключиться к базе `stage-eu`.
3. **Адреса** — поддомены `stage.` в доменах своей зоны:

   | Экземпляр | Апекс стенда | Приложение | Гайд | Почта (просмотр) |
   | --- | --- | --- | --- | --- |
   | `stage-ru` | `stage.remuka.ru` | `app.stage.remuka.ru` | `docs.stage.remuka.ru` | `mail.stage.remuka.ru` |
   | `stage-eu` | `stage.remuka.com` | `app.stage.remuka.com` | `docs.stage.remuka.com` | `mail.stage.remuka.com` |

   Апекс стенда ведёт себя как апекс прода (302 на приложение) — так проверяются S-01/S-02.
   Cookie приложения — только хостовые (`apps/sync/origins.mjs` не расширяет домен cookie),
   поэтому `app.stage.remuka.ru` не получает cookie `app.remuka.ru` и наоборот. Это проверка
   приёмки (§8), не допущение.
4. **Доступ — basic auth на внешнем nginx**, один логин и пароль на стенд (у каждого
   тестировщика — свой, файл `htpasswd`). Не cookie-пропуск и не список IP: cookie — защита
   неизвестностью и путается с cookie приложения, IP у тестировщиков меняются.
5. **Стенд объявляет себя стендом**: `REMO_STAGE=1`. Флаг включает плашку, `noindex`,
   ограничения почты и платежей (§5). Без флага те же опасные настройки на проде запрещены.

## 2. DNS и TLS

- На VPS стенда: `A` для `stage`, `*.stage` в обеих зонах (`remuka.ru`, `remuka.com`).
  AAAA — только если nginx слушает IPv6 (`spec/cloud-zones.md` §2).
- Сертификаты Let's Encrypt на каждый хост (HTTP-01), как на проде. Wildcard не нужен.
- TLS и заголовки безопасности — как на проде (`deploy/nginx-security-headers*.conf`).

## 3. Параметризация установки

Все новые параметры имеют значения по умолчанию, равные нынешним: выкладка прода без
изменений конфигурации работает как раньше.

| Параметр | По умолчанию | Где читается | Что меняет |
| --- | --- | --- | --- |
| `REMO_DEPLOY_ROOT` | `/srv/remo` | `release.sh` (в `config.sh` — новый допустимый ключ), передаётся на сервер как `REMO_ROOT` | каталог установки: `shared/`, `releases/`, `backups/`, `current` |
| `REMO_COMPOSE_PROJECT` | `remo` | `compose.production.yml`: `name: ${REMO_COMPOSE_PROJECT:-remo}` | имена контейнеров, томов, сети `backend` |
| `REMO_WEB_ALIAS` | `remo-web` | алиас `web` в сети `edge` | куда смотрит внешний nginx |
| `REMO_DB_NAME`, `REMO_DB_OWNER` | `remo`, `remo` | `db-tools` (`PGDATABASE`, `PGUSER`) | бэкап и миграции идут в базу своего экземпляра |
| `REMO_DB_HOST`, `REMO_DB_NETWORK`, `REMO_EDGE_NETWORK` | уже есть | `production.env` | свой контейнер базы и своя сеть базы на экземпляр |

Правки:

1. `deploy/config.sh`: принять ключи `REMO_DEPLOY_ROOT`, `REMO_COMPOSE_PROJECT`, `REMO_WEB_ALIAS`.
   `REMO_DEPLOY_ROOT` — абсолютный путь из `[A-Za-z0-9/_-]`, без `..`; иначе ошибка.
   Остальные — `[a-z0-9-]+`.
2. `deploy/release.sh`: все `/srv/remo` заменить на значение `REMO_DEPLOY_ROOT`; передать
   `REMO_ROOT`, `REMO_COMPOSE_PROJECT`, `REMO_WEB_ALIAS` в удалённую часть (как сейчас
   передаются `REMO_VERSION`, `REMO_BUILD`). Проверка SSH проверяет каталог этого экземпляра.
3. `deploy/remo`: уже читает `REMO_ROOT`; `compose()` передаёт `-p "$REMO_COMPOSE_PROJECT"`.
   Значения проекта и алиаса сохраняются в `$ROOT/shared/instance.env` при первой выкладке, и
   команды `status`, `logs`, `backup` на сервере берут их оттуда — чтобы ручной вызов
   `/srv/stage-ru/remo status` не открыл чужой проект.
4. `deploy/bootstrap.sh`: каталог из `REMO_DEPLOY_ROOT`; вывод подсказывает имя проекта.
5. `deploy/remo-backup.service`/`.timer` → шаблоны `remo-backup@.service`/`.timer`, где
   `%i` — имя экземпляра, каталог `/srv/%i`. Прод переходит на `remo-backup@remo` с каталогом
   `/srv/remo` — проверить, что старый таймер выключен и бэкап не идёт дважды.
6. `deploy/remo-sync.service` (systemd без docker, ссылается на `/srv/remo/.env`) — устаревший
   путь самостоятельной установки; не трогать, но отметить в `docs/self-hosting.md`, что
   несколько экземпляров поддерживаются только через compose.

Файлы выкладки на машине разработчика: `.config/remo/stage-ru.env.local`,
`.config/remo/stage-eu.env.local` (mode 600, не в git):

```
REMO_DEPLOY_HOST=deploy@<ip стенда>
REMO_DEPLOY_ROOT=/srv/stage-ru
REMO_COMPOSE_PROJECT=stage-ru
REMO_WEB_ALIAS=stage-ru-web
REMO_APP_ORIGIN=https://app.stage.remuka.ru
REMO_DOCS_ORIGIN=https://docs.stage.remuka.ru
```

Попутная правка прода: в `.config/remo/com.env.local` и `ru.env.local` сейчас
`REMO_APP_ORIGIN=https://remuka.com` / `https://remuka.ru` — должно быть
`https://app.remuka.com` / `https://app.remuka.ru` (`spec/cloud-zones.md` §1).

## 4. Сервер стенда

```
/srv/stage-ru/   shared/production.env  shared/instance.env  releases/  backups/  current
/srv/stage-eu/   …то же…
```

| Компонент | `stage-ru` | `stage-eu` |
| --- | --- | --- |
| PostgreSQL 16 (контейнер) | `stage-ru-postgres`, сеть `stage-ru-db`, том `stage-ru-pg` | `stage-eu-postgres`, сеть `stage-eu-db`, том `stage-eu-pg` |
| Приложение | проект `stage-ru`, алиас `stage-ru-web` | проект `stage-eu`, алиас `stage-eu-web` |
| Почта | Mailpit `stage-ru-mail` | Mailpit `stage-eu-mail` |
| Внешний nginx | один на машину, сеть `edge` общая | |

- Базы поднимаются `deploy/stage/compose.db.yml` (новый файл, параметр — имя экземпляра):
  PostgreSQL с паролем из `shared/production.env`, без опубликованных портов.
- Mailpit — `deploy/stage/compose.mail.yml`: SMTP только во внутренней сети экземпляра,
  веб-интерфейс через внешний nginx на `mail.stage.…` за тем же basic auth.
- Бэкапы стенда — тот же таймер (`remo-backup@stage-ru`), хранение 3 дня: стенд не прод, но
  восстановление после неудачной миграции нужно и здесь.

### 4.1 nginx стенда

Новый шаблон `deploy/stage/nginx-stage.conf` на основе `nginx-remo.conf`, `nginx-site.conf`,
`nginx-docs.conf` с подстановкой `STAGE_SUFFIX` (`stage.remuka.ru`) и `WEB_ALIAS`:

- `auth_basic "Ремука — тестовый стенд"` и `auth_basic_user_file /etc/nginx/stage.htpasswd`
  на всех хостах стенда.
- **Без basic auth** (`auth_basic off`), только эти пути:
  - `/api/billing/webhooks/` — уведомления провайдеров; они проверяются подписью
    (`apps/sync/billing-catalog-api.mjs`), а провайдер не умеет basic auth.
  - `/api/health` — проверка `release.sh` после выкладки.
- `/mcp` и маршруты агентов (`nginx-remo-agents.conf`) остаются за basic auth: внешние клиенты
  на стенде не нужны. Нужны будут — отдельное решение.
- `add_header X-Robots-Tag "noindex, nofollow" always;` на всех хостах; `/robots.txt` —
  `Disallow: /`.
- WebSocket `/sync` за basic auth: браузеры передают сохранённые учётные данные в запросе
  того же источника. Проверить в Chrome, Firefox и Safari (§8); если какой-то не передаёт —
  исключить `/sync` из basic auth, он и так требует сессию.

## 5. Флаг `REMO_STAGE=1`

| Что | При `REMO_STAGE=1` | Без флага (прод) |
| --- | --- | --- |
| Плашка | Узкая полоса сверху «Тестовый стенд · данные удаляются» на всех экранах, письмах (тема с префиксом `[Стенд]`/`[Stage]`) и экспортах PNG/PDF (водяной знак «Стенд») | нет |
| Индексация | `noindex` в HTML и заголовке, как в §4.1 | как сейчас |
| Черновики документов | `REMO_LEGAL_ALLOW_DRAFTS=1` разрешён | `REMO_LEGAL_ALLOW_DRAFTS=1` → **сервис не стартует** с понятной ошибкой |
| Почта | Драйвер `smtp` на Mailpit. Драйверы `resend` и внешний `smtp` разрешены только вместе с `REMO_MAIL_ALLOW_RECIPIENTS` (список адресов и доменов через запятую); письмо на адрес вне списка — `mail_outbox.status = 'suppressed'` с причиной | `REMO_MAIL_ALLOW_RECIPIENTS` игнорируется |
| Платежи | `billing:providers create --mode live` отказывает; существующие live-подключения не используются (ошибка при оплате, событие в журнале) | без изменений |
| `/api/health` | `"stage": true` | поле отсутствует |
| Сброс и наполнение | `stage:reset`, `stage:seed` работают | отказываются с ошибкой |

- Флаг читается в одном модуле (`apps/sync/stage.mjs`), все места выше спрашивают его, а не
  `process.env` напрямую. Тест: при `REMO_STAGE` не равном `1` ни одно поведение из левой
  колонки не включается.
- Префикс в теме письма — в общем рендере писем, не в шаблонах.

## 6. Наполнение и сброс

`pnpm stage:seed` (на основе `scripts/demo-seed.mjs`), идемпотентный, только при
`REMO_STAGE=1`. Создаёт в своей установке:

| Фикстура | Для сценариев |
| --- | --- |
| `owner@<домен-теста>` — владелец организации на Free, 5 комнат (на границе лимита) | S-42, S-50, S-51 |
| `pro@…` — организация на Pro, оплачена тестовым платежом | S-51, S-56, S-95 |
| `colleague@…` — участник организации `owner@` | S-32, S-33, S-37, S-82 |
| `legacy@…` — аккаунт без записей о принятии текущих документов | S-16 |
| `operator@…` — роль оператора (`operator:grant`), TOTP **не** подключён | S-90…S-97 |
| Комната с публичной ссылкой и паролем `stage` | S-34, S-35, S-96 |

- Пароли фикстур и домен адресов — из `shared/production.env` стенда
  (`REMO_STAGE_SEED_PASSWORD`, `REMO_STAGE_SEED_DOMAIN`), не в репозитории.
- Тестовые подключения платежей создаются вручную один раз (`billing:providers create --mode
  test`), seed их не трогает.

`pnpm stage:reset --yes` — только при `REMO_STAGE=1`: останавливает сервис, удаляет и создаёт
заново базу экземпляра, прогоняет миграции, запускает `stage:seed`, очищает Mailpit. Пишет в
лог, кто и когда сбросил.

## 7. Порядок работ

1. Параметризация (§3) с тестами `deploy/config.sh` на новые ключи; выкладка прода
   существующей конфигурацией не меняется — проверить на `remuka.com`.
   **До выкладки этого пункта** убрать `REMO_LEGAL_ALLOW_DRAFTS=1` из `production.env` обоих
   продов, если он там стоит: после §5 прод с ним не стартует.
   _Код и тесты — часть A, сделано. Проверка на `remuka.com` — при выкладке._
2. `REMO_STAGE` и всё из §5, тесты.
3. `stage:seed`, `stage:reset`.
4. `deploy/stage/*`: compose базы и почты, шаблон nginx, инструкция
   `docs/operations/stage.md` (подготовка VPS, DNS, htpasswd, первая выкладка, сброс).
   _Часть A, сделано._
5. Владелец: VPS, DNS-записи, пользователи htpasswd. Затем первая выкладка обоих экземпляров.

## 8. Приёмка

- [ ] `REMO_DEPLOY_ENV_FILE=.config/remo/com.env.local bash deploy/release.sh` на проде
      работает как раньше, `docker compose ls` показывает проект `remo`, бэкап идёт один раз
      в сутки.
- [ ] Обе выкладки стенда проходят; `docker compose ls` на стенде — `stage-ru`, `stage-eu`;
      `/api/health` обоих — `"stage": true`, свои `commit` и `schema`.
- [ ] Аккаунт, созданный на `app.stage.remuka.ru`, не входит на `app.stage.remuka.com`
      (S-15); базы физически разные (`stage-ru-postgres`, `stage-eu-postgres`).
- [ ] Без логина basic auth любой хост стенда отвечает 401; `/api/health` и
      `/api/billing/webhooks/...` — без него. Тестовый вебхук ЮKassa доходит и меняет статус
      платежа.
- [ ] Работа вдвоём в комнате (S-32) идёт по WebSocket в Chrome, Firefox и Safari за basic
      auth.
- [ ] Cookie `app.remuka.ru` не отправляются на `app.stage.remuka.ru` (DevTools → Cookies).
- [ ] Плашка видна на всех экранах; тема письма с префиксом; PNG с водяным знаком.
- [ ] `curl -I https://app.stage.remuka.ru/ -u …` — `X-Robots-Tag: noindex, nofollow`.
- [ ] Письмо на адрес вне `REMO_MAIL_ALLOW_RECIPIENTS` при внешнем драйвере не уходит, в
      outbox — `suppressed`.
- [ ] На проде `REMO_LEGAL_ALLOW_DRAFTS=1` без `REMO_STAGE=1` — сервис не стартует.
- [ ] `stage:reset --yes` возвращает стенд к фикстурам за несколько минут; на проде команда
      отказывает.
