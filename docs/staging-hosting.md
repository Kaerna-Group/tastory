# HTTPS staging на GitHub Pages

Тестовая web-сборка опубликована на [GitHub Pages](https://kaerna-group.github.io/tastory/). Это окружение проверки платформы; авторизация и сохранение рецептов ещё не реализованы.

Первая публикация: 2 сентября 2026, commit `0285460`, [Publish staging](https://github.com/Kaerna-Group/tastory/actions/runs/33680492260). Quality и локальные smoke прошли до публикации. Во встроенном браузере на HTTPS странице настроек получено «Соединение проверено».

После включения echo обязательный [повторный прогон](https://github.com/Kaerna-Group/tastory/actions/runs/33681506028) завершился: **8 успешно, 0 пропусков, 0 ошибок**. Health и echo подтверждены в Chrome, Edge, Firefox и WebKit. Отдельная [проверка настоящего Safari на macOS](https://github.com/Kaerna-Group/tastory/actions/runs/33681876348) тоже успешна. S0-03 закрыт. [Подробный результат](staging-verification.md#проверка-опубликованного-https-origin).

## Публикация

Workflow **Publish staging** (`.github/workflows/staging-pages.yml`) запускается вручную, только из `main`. Он:

1. Выполняет установку и быстрый `npm run check`: статические проверки, unit/coverage и сборки.
2. Собирает staging с настоящим Google API и base path из GitHub Pages.
3. Проверяет размер сборки и публикует только `apps/web/dist`.
4. Без установки браузеров проверяет опубликованные HTML, входной JavaScript и публичный backend
   health.

Playwright, PDF, визуальная матрица и многократные прогоны истории в GitHub Actions не запускаются.
Перед публикацией release candidate полный набор выполняется локально командой `npm run check:all`;
целевые N4 и history-прогоны можно запускать отдельно через `npm run test:auth:n4` и
`npm run test:auth:history-stability`.

Публичный адрес Google API хранится в repository variable `STAGING_API_URL`; Google credentials для workflow не нужны. `.env.staging.local` используется только на рабочем компьютере. Изменение переменной требует новой публикации, поскольку Vite встраивает её в JavaScript при сборке.

Для повторной публикации: GitHub → Actions → Publish staging → Run workflow → main. Простой push обновляет исходники и запускает CI, но сам по себе не публикует сайт. Apps Script этим workflow не изменяется.

## Проверки браузеров

`npm run test:staging` вручную запускает с рабочего компьютера отдельный набор `staging-tests`,
который не входит ни в обычный CI, ни в Publish staging. Нужны `STAGING_URL` (HTTPS адрес сайта) и
`STAGING_API_URL` (`/exec`).

- Health проходит через настоящий интерфейс приложения; проверяются POST, JSON-контракт, requestId и успешное состояние подключения после Google redirect.
- Echo отправляет несекретную строку с кириллицей и Unicode с того же origin. Проверяются redirect, requestId и точное совпадение ответа.
- Chrome и Edge используют установленные каналы этих браузеров. WebKit — тест движка; он **не заменяет реальный Safari** на macOS/iOS.
- Сервер работает с `credentials: omit`; отключение защиты браузера или `no-cors` не используются.

Echo управляется Script Property `ENABLE_SPIKE_ECHO`. При значении, отличном от `true`, локальные
тесты echo отмечаются как пропущенные, а не успешные. Для обязательного полного ручного прогона
владелец временно задаёт `ENABLE_SPIKE_ECHO=true` и передаёт `REQUIRE_STAGING_ECHO=true` локальной
команде; тогда отключённый echo приводит к ошибке проверки.

Изменение Script Property не требует новой версии Apps Script: существующий сервер читает его при каждом запросе. После проверки echo можно снова выключить. Полный gate закрывается только после зафиксированного успешного echo и остальных сценариев [чек-листа](spike-checklist.md).

Свойство нужно менять в **Tastory - Staging API**, связанном с текущим `/exec`. Проект, открытый через «Расширения → Apps Script» в таблице, может быть другим, привязанным к таблице. Он не наследует код и свойства отдельного backend. Точная ссылка рабочего проекта сохранена в локальной карточке `.local/google-staging.md`.

## Настоящий Safari

Workflow **Verify Safari staging** (`.github/workflows/staging-safari.yml`) — отдельное исключение для
приёмки настоящего Safari, который недоступен на локальном Windows-компьютере. Он запускается только
вручную и по отдельному решению перед выпуском, никогда не является частью обычного CI или Publish
staging. Workflow использует стандартный macOS runner и установленный Safari с нативным
`/usr/bin/safaridriver`. В изолированном automation-окне проверяются состояние подключения в
интерфейсе, POST health и точный Unicode echo после redirect. TLS-проверка и защита браузера не
отключаются.

Скрипт `scripts/check-safari-staging.mjs` использует встроенные модули Node и W3C WebDriver, не требует дополнительных npm-зависимостей. Echo здесь обязателен. Результат с версией Safari, ОС и ответами сохраняется в `safari-staging-checks` на 7 дней. Этот workflow только проверяет уже опубликованный сайт, не меняя deployment. Первый успешный результат — Safari 26.5.2 на macOS 26.5.2; iOS отдельно не проверялся.

## Обновление и восстановление

Сбой проверки перед публикацией не меняет работающий сайт. Сбой HTTP-проверки после публикации
отмечает workflow неуспешным, но автоматически не откатывает уже опубликованную сборку. Для
исправления внесите изменение в main и повторите публикацию; при необходимости восстановите
известное рабочее состояние через revert и новый прогон.

Production требует отдельного выбора ресурсов, авторизации и правил выпуска. Текущая публикация обслуживает только staging.

## Источники

- [Custom workflows для GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Поддерживаемые браузеры Playwright](https://playwright.dev/docs/browsers)
- [Нативный WebDriver Safari](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari)
