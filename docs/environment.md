# Среда разработки

## Требования

Node.js 24.14.0 (ветка 24 LTS), npm 11.9.0, Git. Для браузерных тестов нужен Chromium из Playwright. Google и clasp нужны только для удалённого spike.

Node/npm глобально автоматически не обновляются. Версии проверяются через `node --version` и `npm --version`. Используйте подходящий менеджер версий Node; в корне есть `.nvmrc` и `.node-version`. npm при необходимости устанавливается явно: `npm install --global npm@11.9.0`.

## Установка с нуля

```sh
npm ci
npm run dev
```

Установка выполняется из корня, один lockfile на все workspaces. Общие пакеты не требуют отдельной сборки: Vite/esbuild читают их TypeScript public API.

Без env-файлов используется local + mock. Vite слушает только 127.0.0.1. Для переопределений скопируйте `apps/web/.env.example` в `apps/web/.env.development.local`.

Имя `local` зарезервировано Vite. Локальная сборка использует режим Vite `mock`, при этом `VITE_APP_ENV=local`.

## Команды

| Команда                                      | Результат                               |
| -------------------------------------------- | --------------------------------------- |
| `npm run dev`                                | Разработка с hot reload                 |
| `npm run dev -- --port 5174`                 | Другой порт                             |
| `npm run build`                              | Web mock, Apps Script, проверка бюджета |
| `npm run preview`                            | Просмотр web-сборки на 4173             |
| `npm run build:staging`                      | Web для тестового API                   |
| `npm run build:production`                   | Web для production API                  |
| `npm run typecheck`                          | Типы всех пакетов и инструментов        |
| `npm run lint` / `npm run lint:architecture` | Качество и границы                      |
| `npm run format`                             | Форматирование кода и документации      |
| `npm run test:watch`                         | Unit/contract tests в watch-режиме      |
| `npm run check`                              | Все локальные проверки кроме браузера   |
| `npm run check:all`                          | Проверки вместе с Playwright            |
| `npm run audit:dependencies`                 | Известные уязвимости npm                |

## Окружения

| Настройка        | Local                  | Staging            | Production            |
| ---------------- | ---------------------- | ------------------ | --------------------- |
| `VITE_APP_ENV`   | local                  | staging            | production            |
| `VITE_API_MODE`  | mock                   | apps-script        | apps-script           |
| `VITE_API_URL`   | пусто                  | URL staging /exec  | URL production /exec  |
| `VITE_BASE_PATH` | /                      | / или /tastory/    | / или /tastory/       |
| Файл             | .env.development.local | .env.staging.local | .env.production.local |

Шаблоны — в `apps/web/.env*.example`. Значения `REPLACE_*` обязательно заменить. У production и staging разные Google-ресурсы.

`VITE_*` попадает в публичный JavaScript: здесь допустимы только публичные настройки. Google ID token, service account key и clasp credentials сюда не помещаются. Публичный OAuth client ID задаётся в `VITE_GOOGLE_CLIENT_ID`; пустое значение оставляет кнопку входа выключенной. [Настройка Google auth](google-auth-staging.md).

Сборки staging/production отклоняют mock и отсутствующий URL. Успешная сборка не доказывает, что удалённый API прошёл gate.

## Текущее подключение Google staging

На рабочем компьютере заполнен `apps/web/.env.staging.local` с опубликованным `/exec`. Для запуска приложения с настоящим API:

```sh
npm run dev:staging -- --port 5178 --strictPort
```

Откройте `http://127.0.0.1:5178/#/settings`: успешный запрос показывает «Соединение проверено». Обычный `npm run dev` сохраняет local/mock. На другом компьютере env-файл нужно заполнить заново: он исключён из Git. [Результаты проверки и оставшиеся шаги](staging-verification.md).

## Troubleshooting

- Другой Node/npm: переключите версию, повторите `npm ci`.
- Занят 5173: задайте другой порт.
- Не найден браузер: `npx playwright install chromium`.
- PowerShell запрещает npm.ps1: запускайте `npm.cmd` без изменения системной execution policy.
- После изменения env перезапустите Vite.
- Ошибка Google: проверьте URL /exec, доступ, redirect и CORS по чек-листу spike.
- Если localStorage недоступен, тема действует в текущей вкладке, но не сохраняется.
