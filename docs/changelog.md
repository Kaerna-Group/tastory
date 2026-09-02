# Журнал изменений

## 2026-09-02 — основа проекта

### Реализовано

- Инициализирован локальный Git (main), без remote и commit.
- Созданы пять npm workspaces, закреплены Node/npm и точные версии зависимостей.
- Настроены React/Vite/Tailwind/Router/Query, FSD и alias.
- Подготовлены библиотека, настройки, 404, светлая/темная тема с сохранением.
- Добавлены общие API v1 схемы, mock/HTTP transport, правило времени рецепта, дизайн-токены.
- Собирается Apps Script health/echo с глобальными entrypoints и изолированным smoke.
- Подготовлены env templates, clasp, CI, архитектурные проверки, coverage, bundle budgets и Playwright.
- Создана документация и первые три ADR.

### Проверка

- Unit/contract/architecture tests: **44 успешно**.
- Playwright: **6 успешно**, desktop и mobile Chromium.
- TypeScript и проверка архитектуры: успешно.
- Web и Apps Script build: успешно.
- Начальный маршрут: **83.1 KiB gzip** при бюджете 250 KiB; JS chunks меньше 200 KiB raw.
- npm audit при установке: **0 известных уязвимостей**.
- Чистая установка npm ci и единый npm run check:all: **успешно**.
- Coverage выбранного фундамента: **90.16% lines**, **94.59% branches**.
- Проверены ссылки всех 17 Markdown-документов README/docs.
- Локальный просмотр запущен на http://127.0.0.1:5178/; стандартная команда npm run dev использует 5173.
- Для E2E выделен порт 4187, переопределяется через PLAYWRIGHT_PORT.

### Следующие шаги

Подключить Google staging, выполнить [этап 0](spike-checklist.md). Авторизация, Sheets/Drive, CRUD, публикация приложения и PWA ещё не реализованы.

## 2026-09-02 — подключение GitHub

- Настроен origin `git@github.com-personal:Kaerna-Group/tastory.git`.
- Подтверждён доступ личного SSH-ключа аккаунта Ermolz69.
- В этом репозитории закреплён автор и создатель коммитов: Ermolz <00ermzahar@gmail.com>.
- Основа опубликована в main коммитом `3bd468b`; настроено отслеживание origin/main.
- GitHub связал автора и создателя коммита с аккаунтом Ermolz69.
- Первый [CI на Ubuntu](https://github.com/Kaerna-Group/tastory/actions/runs/33673983434) завершился успешно: Quality and smoke, обе сборки и браузерные проверки.
- Подготовлен [порядок следующих задач](next-steps.md): Google staging, gate платформы, данные и пользователи, затем структурированный рецепт.

## 2026-09-02 — подготовка Google staging

- Создан отдельный Google Apps Script project Tastory - Staging API и настроен локальный clasp.
- В Google загружены Code.js и manifest с health/echo и функцией `setupStaging`.
- Добавлено создание тестовых Spreadsheet и Drive folder с записью ID в Script Properties, блокировкой и повторным использованием сохранённых ресурсов.
- Настройка отказывает для другого окружения и ресурсов без метки staging; при ошибке создания папки сохраняет уже записанную привязку таблицы.
- `setupStaging` не добавлена в публичный API. Проверяется отказ для такого RPC action.
- Подготовлены [инструкция владельца](google-staging.md) и локальная карточка со ссылкой на Google-проект. Приватные ссылки и конфигурация clasp исключены из Git.
- Создание таблицы и папки **ещё не выполнено**: текущий доступ clasp не включает Drive/Sheets, требуется разрешение Google при запуске владельцем.
- Схема данных, web app deployment, auth и удалённый gate остаются открытыми.
- Проверка `npm run check` успешна: 54 теста, TypeScript, lint, архитектура, обе сборки и smoke собранной функции настройки. Исходники Code.js и manifest, прочитанные обратно через Google API, совпали с локальной сборкой.

## 2026-09-02 — подтверждение создания Google-ресурсов

- Владелец подтвердил, что `setupStaging` работает и ссылки на созданные таблицу и папку открываются. S0-01 закрыт по этому подтверждению; независимая проверка данных из API ещё не выполнена.
- Через Google API проверены deployments: имеется только HEAD без web app entrypoint. Опубликованного адреса `/exec` ещё нет.
- Обновлены статус staging, локальная карточка и пошаговая инструкция публикации диагностического health endpoint. Следующий шаг — получить URL web app и проверить настоящий запрос из Tastory.

## 2026-09-02 — подключение Tastory к Google API

- Присланный владельцем URL `/exec` сверён с Apps Script: web app Tastory API, deployment версии 1.
- Заполнен игнорируемый `apps/web/.env.staging.local`, Tastory запущен в staging на `http://127.0.0.1:5178`.
- GET/POST health возвращают HTTP 200 и JSON после redirect; POST сохраняет requestId. Публичный вызов `setupStaging` отклонён с `INVALID_REQUEST`.
- В браузере подтверждено «Соединение проверено» при работе настоящего HTTP transport. Сборка `npm run build:staging` успешна.
- Локальный manifest синхронизирован с уже выбранными владельцем настройками web app. Удалённый код не менялся.
- S0-02 закрыт, S0-03 частично выполнен. Подробности и ограничения зафиксированы в [записи проверки](staging-verification.md); auth, хранение рецептов и полный gate остаются впереди.

## 2026-09-02 — HTTPS staging и проверки браузеров

- Включён GitHub Pages с HTTPS и workflow-публикацией; [Tastory staging](https://kaerna-group.github.io/tastory/) опубликован из `0285460`.
- Добавлен ручной Publish staging: quality и smoke → сборка с Google API → публикация → реальные браузерные запросы. Google API URL задан repository variable, credentials не требуются.
- Локальный `npm run check` успешен: 54 теста, типы, lint, архитектура, обе сборки и размеры bundle. Перед публикацией в GitHub прошли также 6 browser smoke.
- [Первый запуск](https://github.com/Kaerna-Group/tastory/actions/runs/33680492260) успешен: health через интерфейс проходит в Chrome, Edge, Firefox и WebKit. Во встроенном браузере отдельно подтверждено соединение по HTTPS.
- Echo в этом прогоне вернул ACTION_DISABLED: 4 проверки пропущены. Установлено, что пользователь открыл отдельный привязанный к таблице проект со стартовой функцией; рабочий backend и код сохранны в Tastory - Staging API.
- S0-03 остаётся частичным: нужны включение echo в рабочем проекте, успешный повтор и настоящий Safari. Далее — Google-вход и приглашения.

### Завершение транспортных проверок

- Владелец включил echo в рабочем Tastory - Staging API; опубликованный backend подтвердил точный возврат тестовой строки.
- [Обязательный повтор](https://github.com/Kaerna-Group/tastory/actions/runs/33681506028) с `require_echo=true`: **8 успешно, без пропусков и нестабильных повторов** — Chrome, Edge, Firefox и WebKit.
- Добавлен и успешно выполнен [Verify Safari staging](https://github.com/Kaerna-Group/tastory/actions/runs/33681876348): настоящий Safari 26.5.2 на macOS 26.5.2, **3 проверки успешно** (интерфейс, health, echo). Использован нативный SafariDriver без дополнительных зависимостей.
- S0-03 закрыт; следующий приоритет — S0-04/S0-05: Google Sign-In, проверка токена и допуска по приглашению. Полный gate платформы остаётся открытым.
