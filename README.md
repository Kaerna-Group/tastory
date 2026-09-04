# Tastory

<img src="apps/web/public/brand/mark.svg" width="64" height="64" alt="Логотип Tastory: книга рецептов и ложка" />

**Every recipe has a story.**

Личная кулинарная тетрадь. В коде готовы модель и права рецепта, надёжное версионируемое сохранение, локальные черновики, история, резервные копии, приватные фотографии, переносимый импорт/экспорт, [стикер-паки](docs/sticker-packs.md), [шаблоны блюд и напитков](docs/recipe-templates.md), первый [книжный renderer и печать/PDF](docs/recipe-pages.md) и [ограниченная работа без сети](docs/pwa-offline.md). Основа репозитория и HTTPS staging опубликованы; новые модули ещё требуют живого выпуска и проверки. Текущий статус и оставшиеся этапы указаны в [roadmap](docs/roadmap.md).

[Открыть Tastory staging](https://kaerna-group.github.io/tastory/) · [Результаты health/echo](docs/staging-verification.md#проверка-опубликованного-https-origin)

Добавлена [основа журнала операций и аудита](docs/operation-journal.md): подготовка из настроек владельца, сохранение и повтор без дубликатов, продолжение прерванной проверки.

В коде реализованы [модель и права R-01](docs/recipe-model.md), [надёжное сохранение R-02](docs/recipe-storage.md) и [редактор с черновиками R-03/R-04](docs/recipe-editor.md): Google Sheets, HTTP API, ревизии, повторы без дублей, локальная очередь и выбор версии при конфликте. Миграция 003 подготовлена и проверена локально; опубликованный сервер ещё не обновлён.

Добавлены [архив, просмотр и возврат истории рецептов O-01/H-01](docs/recipe-history.md) и [резервные копии O-02](docs/book-backups.md): выбранный снимок восстанавливается как новая ревизия, ручное копирование проверяет целостность, а книга восстанавливается в отдельные ресурсы. Изменения пока локальные.

## Быстрый старт

Нужны Node.js **24.14.0** и npm **11.9.0**.

```sh
npm ci
npm run dev
```

Открыть [http://localhost:5173](http://localhost:5173). Google-аккаунт и env-файл для локального запуска не нужны.

Доступны библиотека, редактор рецепта, настройки, темы и страница 404. Для рецептов, шаблонов и восстановления локальных черновиков нужен вход в Google, сервер со схемой 8 и настройка книги: [запуск и границы редактора](docs/recipe-editor.md). Локальный запуск по умолчанию использует mock API без авторизованного аккаунта.

## Проверки

```sh
npx playwright install chromium
npm run check:all
```

Проверяются форматирование, ESLint, FSD и циклы, TypeScript, unit/contract tests с coverage, web/Apps Script build, размеры JS и браузерные smoke tests. В Linux для полного прогона используйте `npx playwright install --with-deps chromium firefox webkit`.

## Структура

| Каталог                  | Назначение                                                         |
| ------------------------ | ------------------------------------------------------------------ |
| `apps/web`               | React, Vite, Tailwind, Router, TanStack Query; FSD                 |
| `apps/apps-script`       | Минимальные health/echo, esbuild, clasp                            |
| `packages/contracts`     | Общие Zod-схемы API v1                                             |
| `packages/domain`        | Чистые правила без React и Google                                  |
| `packages/design-tokens` | Светлая и темная палитры                                           |
| `scripts`                | Архитектурные проверки, bundle budget, конфигурация clasp          |
| `docs`                   | Руководства, roadmap, решения и журнал                             |
| `e2e`                    | Playwright smoke для desktop и mobile                              |
| `staging-tests`          | Health/echo опубликованного сайта в Chrome, Edge, Firefox и WebKit |

Начните с [оглавления документации](docs/README.md), [настройки среды](docs/environment.md) и [статуса roadmap](docs/roadmap.md).

Логотип, иконки и карточка ссылки: [оформление Tastory и Open Graph](docs/branding.md).

Исходный [blueprint](recipe-book-project-blueprint.md) сохранён как продуктовый и технический ориентир. Реализованный статус фиксируется отдельно в документации.
