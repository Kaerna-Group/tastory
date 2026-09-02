# Проверка подключения Google staging

Дата: **2 сентября 2026 года**. Проверен опубликованный владельцем web app **Tastory API**, версия deployment **1**, метка приложения **staging-foundation**. Принадлежность URL текущему Google-проекту подтверждена через Apps Script API.

## Результаты

| Проверка                   | Результат               | Доказательство                                                                             |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| GET health с `/exec`       | Успешно                 | HTTP 200, JSON, `ok: true`, API v1, schema v0                                              |
| POST health                | Успешно                 | HTTP 200, совпадение requestId, `ok: true`                                                 |
| Redirect                   | Успешно                 | JSON получен после перехода на `script.googleusercontent.com`                              |
| POST `setupStaging`        | Отклонён, как ожидается | `INVALID_REQUEST`; служебная функция через API не запускается                              |
| React → Google из браузера | Успешно                 | В настройках Tastory показаны «Проверка связи с сервером Tastory» и «Соединение проверено» |
| Сборка staging             | Успешно                 | `npm run build:staging` с настоящим `/exec`                                                |

Клиент проверен во встроенном Chromium-браузере с origin `http://127.0.0.1:5178`. Использован обычный HTTP transport приложения: POST, `text/plain;charset=utf-8`, `credentials: omit`, `redirect: follow`. Схема ответа и совпадение requestId проверяются клиентом до отображения успешного соединения. Mock в этом запуске выключен.

Один контрольный прогон вне браузера: GET — 2939 мс, POST health — 2054 мс. Это единичные наблюдения, а не измерение p50/p95. Итоговый ответ содержал `Access-Control-Allow-Origin: *`; успех браузерного запроса дополнительно подтверждён интерфейсом приложения.

Конкретные URL и ответы сохранены локально в `.local/google-deployments.json`, `.local/google-api-check.json` и `.local/google-staging.json`. Эти файлы исключены из Git. Параметры web app в локальном manifest приведены к уже опубликованным владельцем: `USER_DEPLOYING`, `ANYONE_ANONYMOUS`. Удалённый исходный код в рамках подключения не изменялся.

## Как повторить

Локальная конфигурация `apps/web/.env.staging.local` уже заполнена. Из корня репозитория:

```sh
npm run dev:staging -- --port 5178 --strictPort
```

Откройте `http://127.0.0.1:5178/#/settings` и нажмите **Проверить снова**. Если сервер уже работает, повторно запускать его не нужно. Обычный `npm run dev` использует local/mock; для Google нужен `dev:staging`.

На другом компьютере сначала создайте `apps/web/.env.staging.local` по шаблону и укажите тот же опубликованный адрес в `VITE_API_URL`. Он не восстанавливается из Git автоматически.

## Проверка опубликованного HTTPS origin

2 сентября 2026 опубликован [Tastory staging](https://kaerna-group.github.io/tastory/), commit `0285460`. [Обязательный прогон Publish staging](https://github.com/Kaerna-Group/tastory/actions/runs/33681506028) завершился успешно: quality, 6 локальных browser smoke, staging build и публикация, затем health/echo с настоящим API. Echo включён владельцем в рабочем Apps Script; `require_echo=true` исключает пропуск этой проверки.

Origin: `https://kaerna-group.github.io`. Время отчёта Playwright: `2026-09-02T20:51:40.943Z`.

| Браузер         | Версия        | Health через интерфейс | Echo    |
| --------------- | ------------- | ---------------------- | ------- |
| Google Chrome   | 152.0.7977.75 | Успешно                | Успешно |
| Microsoft Edge  | 152.0.4191.62 | Успешно                | Успешно |
| Firefox         | 153.0         | Успешно                | Успешно |
| WebKit          | 26.5          | Успешно                | Успешно |
| Safari на macOS | 26.5.2        | Успешно                | Успешно |

Playwright: **8 успешно, 0 пропусков, 0 ошибок, 0 нестабильных повторов**. Health проверяет настоящий POST приложения, requestId, контракт JSON, Google redirect и состояние «Соединение проверено». Echo вернул точную тестовую строку с кириллицей и Unicode во всех четырёх браузерных проектах.

Настоящий Safari проверен [отдельным workflow](https://github.com/Kaerna-Group/tastory/actions/runs/33681876348), commit проверочного скрипта `1628d89`: **3 проверки успешно** — health через интерфейс, POST health и POST echo. SafariDriver подтвердил Safari 26.5.2, macOS 26.5.2 и `acceptInsecureCerts=false`. Время: `2026-09-02T20:52:48.832Z`—`20:53:08.392Z`. Это отдельный результат настоящего Safari, а не переименование WebKit.

Отчёты доступны в артефактах `staging-browser-checks` и `safari-staging-checks` соответствующих запусков (7 дней хранения); локальные копии итогов — `.local/staging-browser-results.json` и `.local/staging-safari-results.json`. Первоначальный прогон до включения echo имел 4 пропуска; итоговый обязательный прогон их устранил.

Дополнительно встроенный браузер вручную подтвердил успешную связь со страницы настроек опубликованного сайта. Отдельный пустой Apps Script, созданный из таблицы, не является backend этого deployment: настройки echo нужно менять в исходном Tastory - Staging API.

## Оставшиеся проверки

- S0-02 и S0-03 закрыты: health/echo подтверждены с опубликованного HTTPS origin в Chrome, Edge, Firefox и настоящем Safari; WebKit проверен дополнительно.
- Следующий шаг — Google Sign-In, серверная проверка ID token и приглашения (S0-04/S0-05).
- Приватные фотографии, конкурентные записи, измерения payload и квот ещё впереди. iOS отдельно не проверялся.
- Health сообщает `storage: not-configured` и `auth: not-configured`. Созданные таблица и папка ещё не используются для хранения рецептов; подключение API этого не меняет.

Полный [gate платформы](spike-checklist.md) остаётся открытым.
