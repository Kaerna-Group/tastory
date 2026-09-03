# Google Apps Script

## Локальная сборка

```sh
npm run build:apps-script
```

Результат: `apps/apps-script/dist/Code.js` и `appsscript.json`. Проверяются глобальные обработчики, отсутствие известных Node-only конструкций и шаблонов ключей. Поиск секретов эвристический и не заменяет review.

clasp установлен локально. Временная зона manifest — Europe/Moscow (UTC+3). OAuth scopes определяются Apps Script автоматически: функция настройки использует SpreadsheetApp и DriveApp. Владелец выдаёт разрешения при первом запуске.

## Подключение staging

Подготовлен D-02d-01: [журнал операций и аудит](operation-journal.md). Подготовка двух новых листов выполняется авторизованным владельцем в настройках Tastory; прежние импорт и активация не повторяются. Схема 2 сохраняет доступ owner/viewer и поддержку старого auth/spike контракта. Фактическая публикация новой серверной версии фиксируется отдельно ниже.

Схема D-01 и перенос D-02a подтверждены настоящими повторными запусками владельца. Переключение D-02b выполнено 3 сентября в 14:37:18; доступ owner/viewer подтверждён. Повторять активацию не нужно. Далее — [раздел владельца](workspace-admin.md).

В web app **версии 5** опубликовано переключение проверки доступа на Sheets. Оно уже включено владельцем: [результат](evidence/2026-09-03-sheets-auth-activated.json). Редактор содержит диагностику, настройку схемы, перенос и `activateStagingSheetsAuth`. [Проверки выпуска версии 5](evidence/2026-09-03-sheets-auth-release.json). Сама загрузка исходников в редактор не меняет опубликованную версию API; для этого отдельно создаётся и выбирается снимок версии.

Текущий серверный выпуск — **версия 6**, опубликована 3 сентября в 12:06:00 UTC из `b85e01b`. Добавлены `admin.users.list` и `admin.health`; URL и manifest сохранены. [Раздел владельца и границы проверки](workspace-admin.md). Повторный запуск активации или миграции для выпуска не требуется.

Для текущего staging проект уже создан, `.clasp.json` настроен, код загружен. Владелец подтвердил успешный запуск `setupStaging` и доступность таблицы и папки. Первоначальное подключение выполнялось на web app версии 1; [история проверок](staging-verification.md). Повторять создание ресурсов и deployment владельцу не нужно.

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

Инструкция ниже предназначена для нового deployment. Текущий уже работает; его URL хранится в локальной конфигурации. Настройки `webapp` в manifest совпадают с опубликованными владельцем: запуск от владельца и доступ Anyone для диагностического API.

1. В редакторе Apps Script нажмите **Развернуть / Deploy → Новое развертывание / New deployment**.
2. Выберите тип через значок шестерёнки: **Веб-приложение / Web app**. Описание — `Tastory staging — health`.
3. **Запуск от имени / Execute as** — **Я / Me**. **У кого есть доступ / Who has access** — **Все / Anyone**, если политика аккаунта разрешает. Нажмите **Развернуть / Deploy** и подтвердите разрешения Google, если они запрошены.
4. Скопируйте **URL веб-приложения** с окончанием `/exec` и передайте его для подключения к Tastory. Открытие ссылки должно вернуть JSON health. `/dev` не подходит для реального клиентского сценария.
5. Подставьте адрес в `VITE_API_URL` файла `apps/web/.env.staging.local` (шаблон — `apps/web/.env.staging.example`), запустите `npm run dev:staging`. Настройки → Подключение должны показать результат реального запроса.
6. Повторите на опубликованном staging origin и заполните [чек-лист](spike-checklist.md).

Этот режим делает доступным диагностический endpoint. Таблица и папка не становятся общедоступными; `setupStaging` через HTTP недоступна. Health пока не читает хранилище. Персональные операции нельзя добавлять до серверной проверки ID token и прав.

Для первой проверки оставьте `DEPLOYMENT_VERSION=staging-foundation` и `ENABLE_SPIKE_ECHO=false`, установленные функцией настройки. При отдельном прогоне echo владелец включает `ENABLE_SPIKE_ECHO=true` и записывает версию проверки в `DEPLOYMENT_VERSION`.

## Production

Ресурсы production ещё не созданы. Нужны отдельные Script ID, Spreadsheet и Drive folder, завершённый spike, auth/RBAC, версии deployment, backup и ручное подтверждение production.

Автоматического production deploy пока нет. После gate он добавляется отдельной задачей с защищённым GitHub Environment. Сам `clasp push` не обновляет неизменяемую опубликованную версию web app.

## Официальные источники

- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [ContentService и redirect](https://developers.google.com/apps-script/guides/content)
- [Работа с clasp](https://developers.google.com/apps-script/guides/clasp)
