# Google Apps Script

## Локальная сборка

```sh
npm run build:apps-script
```

Результат: `apps/apps-script/dist/Code.js` и `appsscript.json`. Проверяются глобальные обработчики, отсутствие известных Node-only конструкций и шаблонов ключей. Поиск секретов эвристический и не заменяет review.

clasp установлен локально. Временная зона manifest — Europe/Moscow (UTC+3). OAuth scopes пока не заданы: Sheets/Drive ещё не используются.

## Подключение staging

1. Войдите в Google и включите Apps Script API в [настройках](https://script.google.com/home/usersettings).
2. Создайте отдельные тестовые Spreadsheet, Drive folder и standalone Apps Script project.
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

5. В Script Properties задайте `DEPLOYMENT_VERSION=spike-001`; при проверке echo — `ENABLE_SPIKE_ECHO=true`.
6. Deploy → New deployment → Web app. Для проверки выбранной архитектуры: выполнение от владельца, доступ Anyone, если политика аккаунта разрешает. Сейчас доступны только несекретные health/echo. Персональные операции нельзя добавлять до серверной проверки ID token и прав.
7. Откройте deployment URL `/exec` и проверьте JSON health. `/dev` не подходит для реального клиентского сценария.
8. Скопируйте `.env.staging.example` в `.env.staging.local`, замените deployment ID, запустите `npm run dev:staging`. Настройки → Подключение должны показать результат реального запроса.
9. Повторите на опубликованном staging origin и заполните [чек-лист](spike-checklist.md).

Credentials clasp обычно находятся в домашней папке; не копируйте их в репозиторий. Spreadsheet/Drive IDs будут храниться на сервере; сейчас backend их не читает.

## Production

Ресурсы production ещё не созданы. Нужны отдельные Script ID, Spreadsheet и Drive folder, завершённый spike, auth/RBAC, версии deployment, backup и ручное подтверждение production.

Автоматического production deploy пока нет. После gate он добавляется отдельной задачей с защищённым GitHub Environment. Сам `clasp push` не обновляет неизменяемую опубликованную версию web app.

## Официальные источники

- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [ContentService и redirect](https://developers.google.com/apps-script/guides/content)
- [Работа с clasp](https://developers.google.com/apps-script/guides/clasp)
