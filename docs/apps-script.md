# Google Apps Script

## Локальная сборка

```sh
npm run build:apps-script
```

Результат: `apps/apps-script/dist/Code.js` и `appsscript.json`. Проверяются глобальные обработчики, отсутствие известных Node-only конструкций и шаблонов ключей. Поиск секретов эвристический и не заменяет review.

clasp установлен локально. Временная зона manifest — Europe/Moscow (UTC+3). OAuth scopes определяются Apps Script автоматически: функция настройки использует SpreadsheetApp и DriveApp. Владелец выдаёт разрешения при первом запуске.

## Подключение staging

Для текущего staging проект уже создан, `.clasp.json` настроен, код загружен. Следующий шаг владельца — запустить `setupStaging` по [инструкции](google-staging.md); повторять команды создания проекта не нужно.

Для нового независимого окружения:

1. Войдите в Google и включите Apps Script API в [настройках](https://script.google.com/home/usersettings).
2. Создайте отдельный standalone Apps Script project.
3. Скопируйте **Script ID** из настроек Apps Script (это не deployment ID).
4. Выполните:

```sh
npm run apps-script:login
npm run apps-script:configure -- YOUR_STAGING_SCRIPT_ID
npm run build:apps-script
npm run apps-script:status
npm run apps-script:push
```

Конфигурация записывается в игнорируемый `apps/apps-script/.clasp.json`. Скрипт не перезаписывает существующую конфигурацию. Перед push проверьте список файлов и целевой проект: push заменяет его удалённый исходный код.

Если первый push пишет `Skipping push`, clasp ожидает подтверждения замены manifest. После проверки целевого проекта и списка файлов загрузите подготовленную сборку с явным подтверждением:

```sh
npm run clasp:push --workspace @tastory/apps-script -- --force
```

5. Запустите `setupStaging` из редактора по [инструкции владельца](google-staging.md). Она создаст Spreadsheet и Drive folder, сохранив ID в Script Properties.

Credentials clasp обычно находятся в домашней папке; не копируйте их в репозиторий. Spreadsheet/Drive IDs хранятся на сервере и читаются функцией настройки; health пока не проверяет эти ресурсы.

## Публикация staging web app

1. В Script Properties задайте `DEPLOYMENT_VERSION=spike-001`; при проверке echo — `ENABLE_SPIKE_ECHO=true`.
2. Deploy → New deployment → Web app. Для проверки выбранной архитектуры: выполнение от владельца, доступ Anyone, если политика аккаунта разрешает. Сейчас доступны только несекретные health/echo. Персональные операции нельзя добавлять до серверной проверки ID token и прав. `setupStaging` через HTTP недоступна.
3. Откройте deployment URL `/exec` и проверьте JSON health. `/dev` не подходит для реального клиентского сценария.
4. Скопируйте `apps/web/.env.staging.example` в `apps/web/.env.staging.local`, замените deployment ID, запустите `npm run dev:staging`. Настройки → Подключение должны показать результат реального запроса.
5. Повторите на опубликованном staging origin и заполните [чек-лист](spike-checklist.md).

## Production

Ресурсы production ещё не созданы. Нужны отдельные Script ID, Spreadsheet и Drive folder, завершённый spike, auth/RBAC, версии deployment, backup и ручное подтверждение production.

Автоматического production deploy пока нет. После gate он добавляется отдельной задачей с защищённым GitHub Environment. Сам `clasp push` не обновляет неизменяемую опубликованную версию web app.

## Официальные источники

- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [ContentService и redirect](https://developers.google.com/apps-script/guides/content)
- [Работа с clasp](https://developers.google.com/apps-script/guides/clasp)
