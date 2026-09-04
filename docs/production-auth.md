# Production Google-вход

Production-код готов к отдельному выпуску. Эта инструкция не публикует сервер и не переносит staging-данные.

## Настройка

1. Создайте отдельный OAuth Web Client для production. В **Authorized JavaScript origins** укажите HTTPS origin сайта без пути, query и fragment. Настройте branding/consent screen.
2. Используйте отдельные Apps Script project, Spreadsheet и Drive folder. Подготовьте в копии книги актуальную схему и пользователей до переключения окружения.
3. Задайте Script Properties: `APP_ENV=production`, `PRODUCTION_GOOGLE_CLIENT_IDS=<client-id>`, `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `SHEETS_AUTH_CONFIG`, `DEPLOYMENT_VERSION`. `ENABLE_SPIKE_ECHO` оставьте `false`. Client ID можно перечислить через запятую, максимум пять уникальных значений.
4. Опубликуйте versioned Apps Script web app от владельца ресурсов. В production web env заполните `VITE_API_URL` и тот же публичный `VITE_GOOGLE_CLIENT_ID` по [шаблону](../apps/web/.env.production.example), затем выполните `npm run build:production`.
5. До переключения постоянного сайта проверьте `health`: поле `auth` обязано быть `production`, а `deploymentVersion` — ожидаемой версией.

Production не читает `GOOGLE_CLIENT_IDS`, `STAGING_INVITES` и `STAGING_AUTH_BINDINGS`. Отсутствующий `SHEETS_AUTH_CONFIG` закрывает вход с `AUTH_NOT_CONFIGURED`.

## Пределы

| Запрос                                     |                             Предел |
| ------------------------------------------ | ---------------------------------: |
| Google credential                          |                       6144 символа |
| Обычное тело API                           | 8192 символа сериализованного JSON |
| `recipes.create` / `recipes.updateContent` |                  2 097 152 символа |
| `auth.signIn` на один credential           |                         6 в минуту |
| `auth.signIn` на deployment                |                        60 в минуту |
| Остальные защищённые запросы на credential |                       120 в минуту |
| Остальные защищённые запросы на deployment |                       300 в минуту |

При `RATE_LIMITED` защищённый запрос не сбрасывает действующую сессию; новый вход остаётся незавершённым. Пользовательские данные не удаляются, запрос повторяют после смены минутного окна. Лимитер хранит только SHA-256 credential и счётчик. Ограничения Apps Script/Sheets/Drive дополнительно действуют по правилам Google.

## Приёмка выпуска

Проверяйте две актуальные стабильные версии Chrome, Edge, Firefox и Safari с опубликованного HTTPS origin:

- кнопка Google загружается, вход возвращает ожидаемую роль;
- выход очищает сессию, обновление страницы требует нового входа;
- повторный вход возвращает тот же `sub` без второго пользователя;
- owner, member и viewer получают только свои разрешённые действия;
- отзыв членства действует на следующем запросе;
- седьмой `auth.signIn` с тем же токеном за минуту возвращает `RATE_LIMITED`, после ожидания вход снова доступен;
- обычный рецепт создаётся, читается и сохраняется; private-рецепт другого пользователя не раскрывается.

Не включайте trace, HAR, DevTools export или скриншоты с credential. В отчёте сохраняйте только дату, браузер/версию, deployment version, исход сценария и requestId. Автоматические fixtures запускаются командой `npm run test:auth`; они проверяют production build и не используют настоящий Google token.
