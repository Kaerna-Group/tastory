# HTTPS staging на GitHub Pages

Тестовая web-сборка размещается в существующем репозитории Kaerna-Group/tastory. Плановый адрес: `https://kaerna-group.github.io/tastory/`. Это окружение проверки платформы; авторизация и сохранение рецептов ещё не реализованы.

## Публикация

Workflow **Publish staging** (`.github/workflows/staging-pages.yml`) запускается вручную, только из `main`. Он:

1. Выполняет установку, `npm run check` и локальные browser smoke.
2. Собирает staging с настоящим Google API и base path из GitHub Pages.
3. Проверяет размер сборки и публикует только `apps/web/dist`.
4. Проверяет опубликованный адрес в Chrome, Edge, Firefox и WebKit.
5. Сохраняет browser report и результаты запросов в артефакте `staging-browser-checks` на 7 дней.

Публичный адрес Google API хранится в repository variable `STAGING_API_URL`; Google credentials для workflow не нужны. `.env.staging.local` используется только на рабочем компьютере. Изменение переменной требует новой публикации, поскольку Vite встраивает её в JavaScript при сборке.

Для повторной публикации: GitHub → Actions → Publish staging → Run workflow → main. Простой push обновляет исходники и запускает CI, но сам по себе не публикует сайт. Apps Script этим workflow не изменяется.

## Проверки браузеров

`npm run test:staging` запускает отдельный набор `staging-tests`, который не входит в локальные mock smoke. Нужны `STAGING_URL` (HTTPS адрес сайта) и `STAGING_API_URL` (`/exec`).

- Health проходит через настоящий интерфейс приложения; проверяются POST, JSON-контракт, requestId и успешное состояние подключения после Google redirect.
- Echo отправляет несекретную строку с кириллицей и Unicode с того же origin. Проверяются redirect, requestId и точное совпадение ответа.
- Chrome и Edge используют установленные каналы этих браузеров. WebKit — тест движка; он **не заменяет реальный Safari** на macOS/iOS.
- Сервер работает с `credentials: omit`; отключение защиты браузера или `no-cors` не используются.

Echo пока выключен в Script Properties. Пока владелец не задаст `ENABLE_SPIKE_ECHO=true`, тесты echo отмечаются как пропущенные, а не успешные. Для обязательного полного прогона включите **require_echo** при запуске workflow. Тогда отключённый echo приведёт к ошибке проверки.

Изменение Script Property не требует новой версии Apps Script: существующий сервер читает его при каждом запросе. После проверки echo можно снова выключить. Полный gate закрывается только после зафиксированного успешного echo и остальных сценариев [чек-листа](spike-checklist.md).

## Обновление и восстановление

Сбой проверки перед публикацией не меняет работающий сайт. Сбой browser verification после публикации отмечает workflow неуспешным, но автоматически не откатывает уже опубликованную сборку. Для исправления внесите изменение в main и повторите публикацию; при необходимости восстановите известное рабочее состояние через revert и новый прогон.

Production требует отдельного выбора ресурсов, авторизации и правил выпуска. Текущая публикация обслуживает только staging.

## Источники

- [Custom workflows для GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Поддерживаемые браузеры Playwright](https://playwright.dev/docs/browsers)
