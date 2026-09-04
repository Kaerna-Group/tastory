# API v1: доступ, участники, журнал, рецепты и диагностика

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

Поддержаны health, echo, auth.signIn, auth.me, admin.users.list, admin.health, три действия admin.operations, пять действий управления доступом, три действия spike.photo и два spike.concurrency. В коде R-02 добавлены [защищённые действия рецептов, тегов, подготовки схемы и восстановления записей](recipe-storage.md#api); их публикация ещё предстоит. Неизвестные поля, действия и версия отклоняются. Поле `credential` требуется для всех защищённых действий; health/echo его не принимают. `expectedRevision` используется в изменении/архиве/восстановлении рецепта, управлении доступом и пробе записей.

POST отправляет JSON с Content-Type `text/plain;charset=utf-8`, без cookies/Authorization. Это избегает собственного preflight, но реальная работа CORS/redirect должна быть доказана на опубликованном origin. Таймаут — 15 секунд, для auth, spike, admin, recipes и tags — 60 секунд; поддержана отмена ожидания. Серверная запись может завершиться после отмены клиентом.

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

## Google auth

`auth.signIn` и `auth.me` принимают пустой `payload` и строку `credential` на верхнем уровне (Google ID token, максимум 6144 символа). В обоих случаях сервер проверяет Google-подпись и claims. После включения Sheets оба действия допускают существующих пользователей с активным членством. На схеме 2 только `auth.signIn` может принять действующее приглашение нового пользователя; `auth.me` не создаёт данные. Вступление использует проверенные Google sub и авторитетный email, роль из Invites и восстанавливаемую операцию с аудитом. Production использует отдельный список Client ID и только Sheets-каталог. [Production-настройка и лимиты](production-auth.md).

Успешный `data`: `{ user: { id, email, name, role }, expiresAt }`; `id` — проверенный `sub`, role — из активного членства в выбранной книге после переключения, срок — из проверенного токена. Ключи и список приглашений не возвращаются. Общие envelope и meta сохраняются; schemaVersion остаётся 0. [Доступ по таблицам и ограничения](sheets-auth-staging.md).

Production ограничивает `auth.signIn` до 6 запросов на credential и 60 на deployment в минуту; остальные защищённые действия — до 120 и 300 соответственно. Превышение или недоступность защитного bucket возвращает `RATE_LIMITED` до проверки подписи и чтения Sheets. Credential в cache не хранится. [Полная таблица пределов](production-auth.md#пределы).

## Раздел владельца

`admin.users.list` и `admin.health` требуют credential, пустой payload и активного владельца выбранного на сервере workspace. Клиент не выбирает книгу и не передаёт роль. Читатель и участник получают `ACCESS_DENIED`; повреждённый каталог — `AUTH_UNAVAILABLE`, сбой административной проверки — `ADMIN_UNAVAILABLE`. Права и срок токена проверяются повторно под общей блокировкой.

- `admin.users.list`: `{ workspace: { id, name }, checkedAt, users: [{ id, email, displayName, role, userStatus, membershipStatus, joinedAt }] }`. Здесь `users[].id` — внутренний UUID, а не wire ID прежнего auth/spike. Возвращаются только участники выбранной книги, максимум 10.
- `admin.health`: `{ workspace: { id, name }, checkedAt, status: "ok", schemaVersion: 1, tablesChecked: 6, members, activeMembers }`. Проверяются структура и журнал миграции шести таблиц, состав и связи пользователей/членств. Это не проверка Drive, квот, содержимого приглашений или резервных копий.

Оба действия только читают данные и не возвращают Google sub или идентификаторы ресурсов Google. Схемы находятся в `packages/contracts/src/admin.ts`; envelope и meta прежние. [Интерфейс и границы](workspace-admin.md).

## Приглашения и права

Все административные действия ниже требуют Google credential и активного владельца, проверенного заново под ScriptLock. Схема таблиц остаётся 2. Общая ожидаемая ревизия приходит из `admin.access.list`, сохраняется в исходной команде и не заменяется автоматически при повторе.

| Действие               | Payload                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `admin.access.list`    | `{}`                                                                                       |
| `admin.invites.create` | `{ email, role: "member" \| "viewer", days: 1..30, expectedRevision }`                     |
| `admin.invites.revoke` | `{ inviteId, expectedRevision }`                                                           |
| `admin.members.update` | `{ userId, role: "member" \| "viewer", status: "active" \| "disabled", expectedRevision }` |
| `admin.access.resume`  | `{ operationId }`                                                                          |

Список возвращает `{ kind: "access", revision, checkedAt, members, invites, pending }`: участники с внутренними ID/именем/email/ролью/статусом, приглашения текущей книги со сроком и состоянием, максимум одна незавершённая запись и возможность её продолжения. Полные контракты — `packages/contracts/src/access.ts`. Планы строк, Google sub и ID ресурсов не возвращаются.

Запись возвращает `{ kind: "saved", outcome: "committed" | "replayed", operationId, entityId, revision }`. `operationId` равен исходному requestId, а при resume — payload.operationId; envelope.requestId всегда относится к текущему запросу. Клиент проверяет оба значения. Replay возвращает первоначальную квитанцию даже после более новой операции; для текущего состояния нужно новое чтение списка.

Ошибки: `ACCESS_CONFLICT` — устаревшая общая ревизия; `ACCESS_PENDING` — требуется завершить предыдущую запись; `ACCESS_LIMIT` — лимит пользователей/приглашений; `ACCESS_INVALID` — действие недоступно для этого адреса/участника; `ACCESS_UNAVAILABLE` — сбой или несовместимые данные. `OPERATION_MISMATCH` означает повтор ID с другим содержимым. Также применяются ошибки auth и журнала. Таймаут административных действий и auth — 60 секунд.

Первое принятие приглашения выполняется внутри `auth.signIn` по проверенным claims, а не через публичный payload с ролью. Начатое вступление возобновляется по сохранённой операции и тому же Google sub; владелец также может завершить его через resume. Письма сервер не отправляет.

## Настройки пользователя

`user.settings.get` принимает пустой payload. `user.settings.update` принимает `expectedRevision` и полный объект параметров профиля/редактора. Оба действия доступны любому активному участнику только для его собственной записи. Ответ имеет `kind: "userSettings"`, снимок `settings` и outcome `read`, `committed` или `replayed`. Подробности: [настройки профиля и редактора](user-settings.md).

Ошибки `SETTINGS_NOT_READY`, `SETTINGS_CONFLICT`, `SETTINGS_UNAVAILABLE` и `OPERATION_MISMATCH` используют общий envelope API v1.

## Журнал операций

Три дополнительных действия требуют credential, строго пустой payload, staging и активного владельца. Повторная проверка прав и срока токена выполняется под ScriptLock. Миграция 002 создаёт схему 2, миграция 003 — схему 3, миграция 004 добавляет фотографии рецепта и схему 4. Вход поддерживает версии 1–4. `admin.health` возвращает пары schemaVersion/tablesChecked: 1/6, 2/8, 3/14 или 4/15. Транспортное meta не меняется.

| Действие                      | Результат data                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `admin.operations.list`       | `{ kind: "list", ready, schemaVersion, checkedAt, total, entries }`                                               |
| `admin.operations.initialize` | `{ kind: "initialized", schemaVersion: 2, alreadyApplied }`                                                       |
| `admin.operations.check`      | `{ kind: "check", outcome: "committed" \| "replayed", entry, result: { kind: "journal-check", verified: true } }` |

`entry`: `{ id, action, actorName, status, startedAt, completedAt, auditRecorded, canRetry }`. Action — `admin.operations.check`, `admin.invites.create`, `admin.invites.revoke`, `admin.members.update` или `auth.invite.accept`. Статус — `started` или `committed`; незавершённая запись имеет `completedAt: null`. Выдаются последние 50 операций текущей книги, total ограничен 1000. `canRetry` относится только к диагностической проверке текущего владельца; записи доступа продолжаются через `admin.access.resume`. Неподготовленный журнал возвращает пустой список с `ready: false` и схемой 1.

`requestId` проверочной операции сохраняется для всех повторов, включая потерю ответа; клиент сверяет его с envelope и entry.id. Повтор с другим пользователем, книгой или содержимым отклоняется. Подготовка повторяется по собственному маркеру миграции. Запись требует готового журнала и не изменяет бизнес-данные или `Meta.data_revision`.

Ошибки: `JOURNAL_NOT_READY` — требуется подготовка; `JOURNAL_UNAVAILABLE` — блокировка, несовместимая схема/состояние или сбой; `JOURNAL_LIMIT` — лимит хранения; `OPERATION_MISMATCH` — другая привязка ключа. Повтор после неопределённого результата использует прежний ID. Контракты — `packages/contracts/src/journal.ts`. [Алгоритм, границы и действия владельца](operation-journal.md).

## Пробное фото

Все три действия требуют staging, действующий credential, ранее закреплённый `sub` и роль owner. Они не принимают Drive IDs или чужой `sub`.

| Действие             | Payload                                      | Результат data                                 |
| -------------------- | -------------------------------------------- | ---------------------------------------------- |
| `spike.photo.upload` | `{ uploadId, imageBase64, thumbnailBase64 }` | `{ photo, thumbnailBase64: null }`             |
| `spike.photo.read`   | `{}`                                         | `{ photo, thumbnailBase64 }` или оба поля null |
| `spike.photo.delete` | `{ id }` — ID ожидаемого тестового фото      | оба поля null                                  |

`photo` содержит `{ id, width, height, bytes, thumbnailBytes, createdAt }`. Envelope/meta общие. Эта staging-проба сохранена; рецепт использует `recipes.photos.add/delete/read`, проверяет права по рецепту и хранит метаданные в схеме 4.

## Проба одновременных записей

`spike.concurrency.read` принимает `{ runId }`. `spike.concurrency.write` принимает `{ runId, operationId, expectedRevision, value }`: UUID, UUID, 0 или 1 и first/second соответственно. Только staging и уже привязанный owner; роль из клиента не принимается. [Сценарий и ограничения](google-concurrency-staging.md).

Успешный data: `{ outcome, state: { runId, revision, value }, appliedOperations, operationRevision }`. Outcome — read/applied/replayed/conflict. Конфликт возвращается как ожидаемый результат без мутации; transport-успех не означает, что запись применена. При replayed возвращается текущее состояние и исходная operationRevision. При read/conflict operationRevision равна null. Клиент проверяет requestId и runId.

PROBE_UNAVAILABLE обозначает сбой/занятую блокировку/неизвестную схему; PROBE_LIMIT — лимит новых проб; OPERATION_MISMATCH — повтор ID с изменённым содержимым. Тело ограничено 8192 символами, ожидание ответа — 60 секунд. Отмена ожидания не отменяет запись на сервере.

## Echo

Action `echo`, payload `{"message":"hello"}`. Успех возвращает payload в data и тот же meta. Сообщение — до 1024 символов. POST ограничивает тело максимумом PHOTO_BODY_LIMIT/RECIPE_BODY_LIMIT до JSON.parse; после разбора применяет 8192 UTF-16 code units для обычных действий, RECIPE_BODY_LIMIT для recipes.create/updateContent/photos.add и PHOTO_BODY_LIMIT для spike.photo.upload. Для загрузки действуют отдельные строгие лимиты base64 и декодированных байтов.

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

Действия истории схемы 3: `recipes.history`, `recipes.version`, `recipes.version.restore`, `admin.recipes.archiveHistory` описаны в [O-01/H-01](recipe-history.md). Возврат требует `expectedRevision` и `targetRevision`, создаёт новую ревизию и возвращает обычную квитанцию `kind: saved`. `admin.backups.list/create/verify/restore`, результаты и ошибки — в [O-02](book-backups.md). Они используют прежний envelope API v1. Операторский `recoverBookBackup` не доступен через HTTP.

Схема 5 добавляет `recipes.favorite.set`. Команда принимает `recipeId` и `favorite`, использует request ID для долговечной защиты от повторов и возвращает `kind: favorite`. `recipes.list` включает только безопасную сводку для библиотеки: имена ингредиентов, теги, ID обложки и личную отметку избранного; заметки, шаги и содержимое файлов в выдачу не входят. Подробности: [R-06](recipe-library.md).

Управление файлами владельца использует `admin.files.audit/trash/trashUnused/restore/cleanup` и возвращает `kind: files` с итогами и списком проблем. Сервер разрешает автоматическое перемещение только для файлов Tastory, не связанных ни с одной сохранённой версией рецепта. Неизвестные и повреждённые файлы остаются на месте. Подробности: [O-04](file-lifecycle.md).

Переносимый формат [X-01](data-transfer.md) не открывает отдельный массовый endpoint и не принимает внутренние строки таблиц. Клиент экспортирует только результаты защищённых `recipes.list/get/photos.read`; импорт выполняется через прежние `tags.create`, `recipes.create` и `recipes.photos.add`. Поэтому каждый объект проходит действующие права, лимиты, квитанции и защиту ожидаемой ревизии.

Схемы v1 строгие. Изменение envelope требует обновления обеих сторон и contract test. До реальных данных не обещается долговременная совместимость диагностики. Версионирование импортов рецептов появится на этапе 6.
