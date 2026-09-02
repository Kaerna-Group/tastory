# Диагностический API v1

Источник схем — `packages/contracts/src/api.ts`. DTO выводятся из Zod. API version = 1, schema version = 0: таблицы и миграции ещё не созданы.

## Запрос

```json
{
  "apiVersion": 1,
  "requestId": "c3dcd2e8-e2f8-428b-9e26-3e715f678fac",
  "action": "health",
  "payload": {}
}
```

Поддержаны health и echo. Неизвестные поля, действия и версия отклоняются. Credential/expectedRevision будут добавлены вместе с auth и записью; текущая диагностика не принимает Google-токены.

POST отправляет JSON с Content-Type `text/plain;charset=utf-8`, без cookies/Authorization. Это избегает собственного preflight, но реальная работа CORS/redirect должна быть доказана на опубликованном origin. Таймаут — 15 секунд, поддержана отмена.

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

## Echo

Action `echo`, payload `{"message":"hello"}`. Успех возвращает payload в data и тот же meta. Сообщение — до 1024 символов. POST отклоняет тело длиннее 8192 UTF-16 code units до JSON.parse.

Echo выключен по умолчанию. В staging включается через Script Property `ENABLE_SPIKE_ECHO=true`. Используйте только несекретные тестовые строки.

## Ошибки

```json
{
  "ok": false,
  "requestId": "c3dcd2e8-e2f8-428b-9e26-3e715f678fac",
  "error": { "code": "ACTION_DISABLED", "message": "Echo отключен для этого окружения." }
}
```

Коды сервера: INVALID_REQUEST, ACTION_DISABLED; INTERNAL_ERROR зарезервирован. Некорректному запросу присваивается новый диагностический requestId; валидный сохраняет свой.

Клиент также различает TRANSPORT_ERROR и INVALID_RESPONSE. HTTP 200 не означает успех: проверяется `ok` в JSON. ContentService не предоставляет обычное управление HTTP-статусами.

## Совместимость

Схемы v1 строгие. Изменение envelope требует обновления обеих сторон и contract test. До реальных данных не обещается долговременная совместимость диагностики. Версионирование импортов рецептов появится на этапе 6.
