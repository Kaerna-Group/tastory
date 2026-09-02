# Tastory

Личная кулинарная тетрадь. Реализована основа репозитория (этап 1), опубликован HTTPS staging и проверена связь с Google API в целевых браузерах (часть этапа 0). Код входа Google и приглашений подготовлен; требуется [настройка OAuth и реальный прогон](docs/google-auth-staging.md). Хранение рецептов ещё впереди.

[Открыть Tastory staging](https://kaerna-group.github.io/tastory/) · [Результаты health/echo](docs/staging-verification.md#проверка-опубликованного-https-origin)

## Быстрый старт

Нужны Node.js **24.14.0** и npm **11.9.0**.

```sh
npm ci
npm run dev
```

Открыть [http://localhost:5173](http://localhost:5173). Google-аккаунт и env-файл для локального запуска не нужны.

Доступны библиотека с пустым состоянием, настройки, светлая/темная тема с сохранением выбора и страница 404. Локальный запуск по умолчанию использует mock API; опубликованный staging обращается к настоящему Google API. Рецепты ещё не создаются и не сохраняются.

## Проверки

```sh
npx playwright install chromium
npm run check:all
```

Проверяются форматирование, ESLint, FSD и циклы, TypeScript, unit/contract tests с coverage, web/Apps Script build, размеры JS и браузерные smoke tests. В Linux для установки браузера используйте `npx playwright install --with-deps chromium`.

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

Исходный [blueprint](recipe-book-project-blueprint.md) сохранён как продуктовый и технический ориентир. Реализованный статус фиксируется отдельно в документации.
