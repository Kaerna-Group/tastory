# Tastory

Личная кулинарная тетрадь. Реализована основа репозитория (этап 1) и локальная заготовка технического spike (этап 0). Это стартовая оболочка, а не готовое хранилище рецептов.

## Быстрый старт

Нужны Node.js **24.14.0** и npm **11.9.0**.

```sh
npm ci
npm run dev
```

Открыть [http://localhost:5173](http://localhost:5173). Google-аккаунт и env-файл для локального запуска не нужны.

Доступны библиотека с пустым состоянием, настройки, светлая/темная тема с сохранением выбора, проверка mock API и страница 404. Рецепты ещё не создаются и не сохраняются.

## Проверки

```sh
npx playwright install chromium
npm run check:all
```

Проверяются форматирование, ESLint, FSD и циклы, TypeScript, unit/contract tests с coverage, web/Apps Script build, размеры JS и браузерные smoke tests. В Linux для установки браузера используйте `npx playwright install --with-deps chromium`.

## Структура

| Каталог                  | Назначение                                                |
| ------------------------ | --------------------------------------------------------- |
| `apps/web`               | React, Vite, Tailwind, Router, TanStack Query; FSD        |
| `apps/apps-script`       | Минимальные health/echo, esbuild, clasp                   |
| `packages/contracts`     | Общие Zod-схемы API v1                                    |
| `packages/domain`        | Чистые правила без React и Google                         |
| `packages/design-tokens` | Светлая и темная палитры                                  |
| `scripts`                | Архитектурные проверки, bundle budget, конфигурация clasp |
| `docs`                   | Руководства, roadmap, решения и журнал                    |
| `e2e`                    | Playwright smoke для desktop и mobile                     |

Начните с [оглавления документации](docs/README.md), [настройки среды](docs/environment.md) и [статуса roadmap](docs/roadmap.md).

Исходный [blueprint](recipe-book-project-blueprint.md) сохранён как продуктовый и технический ориентир. Реализованный статус фиксируется отдельно в документации.
