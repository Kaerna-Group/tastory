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
- Первый push в main запускает workflow CI; статус проверяется после отправки.
