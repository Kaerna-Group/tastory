# Проверки качества

## Основной цикл

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check:all` объединяет проверки. Playwright сам собирает mock web и запускает preview на 127.0.0.1:4187; порт должен быть свободен. Его можно переопределить переменной PLAYWRIGHT_PORT. Уже работающий сервер намеренно не переиспользуется.

## Что покрыто

| Уровень           | Проверки                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Unit              | Расчёт времени, неизвестное/нулевое время, некорректные значения и overflow                           |
| Contracts         | Версия API, UUID, неизвестные поля/actions, payload limits, frontend/backend schema                   |
| Controller        | Health, отключённый/включённый echo, повреждённый и слишком большой JSON                              |
| HTTP client       | Схема ответа, requestId, error codes, text/plain, HTTP/JSON/network failure, отмена                   |
| Architecture      | Допустимые и запрещённые импорты, package isolation; полный граф и циклы                              |
| Apps Script build | doGet/doPost из bundle в изолированном runtime без Node/browser API                                   |
| E2E               | Навигация, mock health, повторная проверка, сохранение темы, 404, клавиатурный переход, ширина mobile |

Vitest: пороги lines/functions/statements — 85%, branches — 80%. Измеряется выбранный фундамент (packages, controller, shared API), а не весь интерфейс. UI проверяется браузерными smoke. Wiring runtime транспорта пока не покрыт отдельным unit test.

Playwright выполняет одни сценарии в desktop Chromium и mobile Chromium (Pixel 7). Это эмуляция экрана, не реальный Android; Firefox/WebKit и visual regression будут добавлены при реализации продуктовых экранов.

## Бюджеты

- Начальный маршрут вместе со статическими импортами: не более 250 KiB gzip.
- Каждый JS chunk: не более 200 KiB raw.
- Editor 450 KiB gzip будет проверяться отдельно, когда появится редактор.

Проверка читает Vite manifest. Vendor splitting не исключает библиотеки из начального бюджета. CSS, картинки, сетевые задержки и Core Web Vitals этой проверкой не измеряются.

## Ограничения

Ни один локальный тест не доказывает реальные CORS, Google JWT, Drive permissions, Sheets locks или квоты. Для них нужен [spike](spike-checklist.md). Тесты схем Sheets, CRUD, RBAC и экспорта добавляются с реализацией соответствующего этапа.

Для реального HTTPS origin есть отдельный `npm run test:staging`: Chrome, Edge, Firefox и WebKit проверяют health и echo. Он запускается после публикации в Publish staging; параметры и трактовка пропущенного echo описаны в [руководстве](staging-hosting.md). Успех WebKit не отмечается как проверка реального Safari.

Для настоящего Safari есть отдельный Verify Safari staging на macOS с нативным SafariDriver. Он проверяет интерфейс, health и обязательный echo без дополнительных npm-зависимостей. Первый полный результат: 8 Playwright checks и 3 Safari checks успешно; доказательства — в [отчёте](staging-verification.md#проверка-опубликованного-https-origin).
