# API v1: доступ, участники, журнал и диагностика

Источник схем — `packages/contracts/src/api.ts`. DTO выводятся из Zod. API version = 1, транспортный schema version = 0 сохранён для совместимости; фактическая схема таблиц 1 создана и подтверждена, схема 2 применяется при подготовке журнала. [Разделение версий](schema-migrations.md). После [переключения входа на Sheets](sheets-auth-staging.md) роль берётся из членства в таблице, формат ответа auth/spike остаётся прежним.

## Запрос

```json
{
  "apiVersion": 1,
  "requestId": "c3dcd2e8-e2f8-428b-9e26-3e715f678fac",
  "action": "health",
  "payload": {}
}
```

Поддержаны health, echo, auth.signIn, auth.me, admin.users.list, admin.health, три действия admin.operations, три действия spike.photo и два spike.concurrency. Неизвестные поля, действия и версия отклоняются. Поле `credential` требуется для всех защищённых действий; health/echo его не принимают. `expectedRevision` используется в ограниченной пробе записей; схемы рецептов ещё нет.

POST отправляет JSON с Content-Type `text/plain;charset=utf-8`, без cookies/Authorization. Это избегает собственного preflight, но реальная работа CORS/redirect должна быть доказана на опубликованном origin. Таймаут — 15 секунд, для spike и admin — 60 секунд; поддержана отмена ожидания. Серверная запись может завершиться после отмены клиентом.

## Health

GET вызывает health. POST принимает action health и пустой payload. Успех:

```json
{
  "ok": true,
  "requestId": "c3dcd2e8-e2f8-428b-9e26-3e715f678fac",
  "data": {
    "status": "ok",
    "service": "tastory-api",
    "deploymentVersion": "foundation",
    "timestamp": "2026-09-02T12:00:00.000Z",
    "storage": "not-configured",
    "auth": "not-configured"
  },
  "meta": { "apiVersion": 1, "schemaVersion": 0 }
}
```

Status ok доказывает выполнение обработчика. Health не проверяет Sheets/Drive, auth, квоты или готовность хранить данные. Ответ не содержит приватных ID и credentials.

Поле `auth` равно `staging`, когда заданы staging-конфигурация клиента и настройка Sheets либо старые приглашения, иначе `not-configured`. Это признак наличия настроек, не доказательство действительности OAuth client или успешного входа. Реальная проверка структуры таблиц доступна отдельно через защищённый `admin.health`.

## Staging auth

`auth.signIn` и `auth.me` принимают пустой `payload` и строку `credential` на верхнем уровне (Google ID token, максимум 6144 символа). В обоих случаях сервер проверяет Google-подпись и claims. После включения Sheets оба действия допускают уже перенесённых пользователей с активным членством. Новый путь принятия приглашений ещё впереди. В прежнем staging-реестре до переключения только `auth.signIn` мог впервые принять приглашение.

Успешный `data`: `{ user: { id, email, name, role }, expiresAt }`; `id` — проверенный `sub`, role — из активного членства в выбранной книге после переключения, срок — из проверенного токена. Ключи и список приглашений не возвращаются. Общие envelope и meta сохраняются; schemaVersion остаётся 0. [Доступ по таблицам и ограничения](sheets-auth-staging.md).

## Раздел владельца

`admin.users.list` и `admin.health` требуют credential, пустой payload и активного владельца выбранного на сервере workspace. Клиент не выбирает книгу и не передаёт роль. Читатель и участник получают `ACCESS_DENIED`; повреждённый каталог — `AUTH_UNAVAILABLE`, сбой административной проверки — `ADMIN_UNAVAILABLE`. Права и срок токена проверяются повторно под общей блокировкой.

- `admin.users.list`: `{ workspace: { id, name }, checkedAt, users: [{ id, email, displayName, role, userStatus, membershipStatus, joinedAt }] }`. Здесь `users[].id` — внутренний UUID, а не wire ID прежнего auth/spike. Возвращаются только участники выбранной книги, максимум 10.
- `admin.health`: `{ workspace: { id, name }, checkedAt, status: "ok", schemaVersion: 1, tablesChecked: 6, members, activeMembers }`. Проверяются структура и журнал миграции шести таблиц, состав и связи пользователей/членств. Это не проверка Drive, квот, содержимого приглашений или резервных копий.

Оба действия только читают данные и не возвращают Google sub или идентификаторы ресурсов Google. Схемы находятся в `packages/contracts/src/admin.ts`; envelope и meta прежние. [Интерфейс и границы](workspace-admin.md).

## Журнал операций

Три дополнительных действия требуют credential, строго пустой payload, staging и активного владельца. Повторная проверка прав и срока токена выполняется под ScriptLock. Приготовленная миграцией 002 фактическая схема таблиц — 2; вход также поддерживает прежнюю схему 1. `admin.health` возвращает пару `schemaVersion: 1, tablesChecked: 6` либо `schemaVersion: 2, tablesChecked: 8`. Транспортное meta не меняется.

| Действие                      | Результат data                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `admin.operations.list`       | `{ kind: "list", ready, schemaVersion, checkedAt, total, entries }`                                               |
| `admin.operations.initialize` | `{ kind: "initialized", schemaVersion: 2, alreadyApplied }`                                                       |
| `admin.operations.check`      | `{ kind: "check", outcome: "committed" \| "replayed", entry, result: { kind: "journal-check", verified: true } }` |

`entry`: `{ id, action: "admin.operations.check", actorName, status, startedAt, completedAt, auditRecorded, canRetry }`. Статус — `started` или `committed`; незавершённая запись имеет `completedAt: null`. Выдаются последние 50 операций текущей книги, total ограничен 1000. `canRetry` разрешён только для незавершённой записи текущего владельца. Неподготовленный журнал возвращает пустой список с `ready: false` и схемой 1.

`requestId` проверочной операции сохраняется для всех повторов, включая потерю ответа; клиент сверяет его с envelope и entry.id. Повтор с другим пользователем, книгой или содержимым отклоняется. Подготовка повторяется по собственному маркеру миграции. Запись требует готового журнала и не изменяет бизнес-данные или `Meta.data_revision`.

Ошибки: `JOURNAL_NOT_READY` — требуется подготовка; `JOURNAL_UNAVAILABLE` — блокировка, несовместимая схема/состояние или сбой; `JOURNAL_LIMIT` — лимит хранения; `OPERATION_MISMATCH` — другая привязка ключа. Повтор после неопределённого результата использует прежний ID. Контракты — `packages/contracts/src/journal.ts`. [Алгоритм, границы и действия владельца](operation-journal.md).

## Пробное фото

Все три действия требуют staging, действующий credential, ранее закреплённый `sub` и роль owner. Они не принимают Drive IDs или чужой `sub`.

| Действие             | Payload                                      | Результат data                                 |
| -------------------- | -------------------------------------------- | ---------------------------------------------- |
| `spike.photo.upload` | `{ uploadId, imageBase64, thumbnailBase64 }` | `{ photo, thumbnailBase64: null }`             |
| `spike.photo.read`   | `{}`                                         | `{ photo, thumbnailBase64 }` или оба поля null |
| `spike.photo.delete` | `{ id }` — ID ожидаемого тестового фото      | оба поля null                                  |

`photo` содержит `{ id, width, height, bytes, thumbnailBytes, createdAt }`. Envelope/meta общие. Ограничения и правила повторных запросов — в [инструкции фото](google-photos-staging.md). Схемы находятся в `packages/contracts/src/photo.ts`.

## Проба одновременных записей

`spike.concurrency.read` принимает `{ runId }`. `spike.concurrency.write` принимает `{ runId, operationId, expectedRevision, value }`: UUID, UUID, 0 или 1 и first/second соответственно. Только staging и уже привязанный owner; роль из клиента не принимается. [Сценарий и ограничения](google-concurrency-staging.md).

Успешный data: `{ outcome, state: { runId, revision, value }, appliedOperations, operationRevision }`. Outcome — read/applied/replayed/conflict. Конфликт возвращается как ожидаемый результат без мутации; transport-успех не означает, что запись применена. При replayed возвращается текущее состояние и исходная operationRevision. При read/conflict operationRevision равна null. Клиент проверяет requestId и runId.

PROBE_UNAVAILABLE обозначает сбой/занятую блокировку/неизвестную схему; PROBE_LIMIT — лимит новых проб; OPERATION_MISMATCH — повтор ID с изменённым содержимым. Тело ограничено 8192 символами, ожидание ответа — 60 секунд. Отмена ожидания не отменяет запись на сервере.

## Echo

Action `echo`, payload `{"message":"hello"}`. Успех возвращает payload в data и тот же meta. Сообщение — до 1024 символов. POST ограничивает всё тело значением PHOTO_BODY_LIMIT до JSON.parse; после разбора оставляет максимум 8192 UTF-16 code units для всех действий, кроме spike.photo.upload. Для загрузки действуют отдельные строгие лимиты base64 и декодированных байтов.

Echo выключен по умолчанию. В staging включается через Script Property `ENABLE_SPIKE_ECHO=true`. Используйте только несекретные тестовые строки.

## Ошибки

```json
{
  "ok": false,
  "requestId": "c3dcd2e8-e2f8-428b-9e26-3e715f678fac",
  "error": { "code": "ACTION_DISABLED", "message": "Echo отключен для этого окружения." }
}
```

Коды сервера: INVALID_REQUEST, ACTION_DISABLED, AUTH_NOT_CONFIGURED, UNAUTHENTICATED, ACCESS_DENIED, AUTH_UNAVAILABLE, PHOTO_INVALID, PHOTO_EXISTS, PHOTO_UNAVAILABLE, PHOTO_NOT_PRIVATE; INTERNAL_ERROR зарезервирован. Некорректному запросу присваивается новый диагностический requestId; валидный сохраняет свой. Ошибки не отражают входящий токен, содержимое фото или внутреннее исключение.

Клиент также различает TRANSPORT_ERROR и INVALID_RESPONSE. HTTP 200 не означает успех: проверяется `ok` в JSON. ContentService не предоставляет обычное управление HTTP-статусами.

## Совместимость

Схемы v1 строгие. Изменение envelope требует обновления обеих сторон и contract test. До реальных данных не обещается долговременная совместимость диагностики. Версионирование импортов рецептов появится на этапе 6.
