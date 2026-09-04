# ADR 0005: Google-вход для ограниченного production

Дата: 2026-09-03. Статус: **принято для закрытой книги на 5–10 приглашённых пользователей**. Заменяет production-часть [ADR 0004](0004-staging-google-auth.md).

## Решение

Production остаётся на Google Identity Services и Apps Script. Браузер получает Google ID token через официальный GIS script и передаёт его в каждом защищённом запросе. Сервер принимает только RS256, фиксированный Google JWKS endpoint и ключи RSA 2048–4096 бит с exponent 65537. Он проверяет подпись, `aud`, `iss`, `exp`, `iat`, `nbf`, `azp`, срок не более двух часов, `email_verified` и границы claims. Пользователь определяется только по `sub`; права перечитываются из Sheets при каждом запросе.

Google рекомендует серверные client/JWT libraries. В Apps Script V8 подходящей официальной библиотеки нет, поэтому остаётся узкий адаптер над `micro-rsa-dsa-dh` 0.4.0. Он использует только проверку публичной подписи PKCS#1 SHA-256, не хранит и не обрабатывает приватные RSA-ключи. Входящие алгоритм, URL ключей и exponent не выбирают поведение сервера. JWK ограничены схемой и размером, ключи обновляются по Google `Cache-Control` под `ScriptLock`; неизвестный `kid` не вызывает неограниченные загрузки.

Production требует `APP_ENV=production`, отдельное свойство `PRODUCTION_GOOGLE_CLIENT_IDS` и табличный `SHEETS_AUTH_CONFIG`. `GOOGLE_CLIENT_IDS`, `STAGING_INVITES` и `STAGING_AUTH_BINDINGS` в production игнорируются. Разрешено не более пяти уникальных Web Client ID. Это не позволяет включить постоянный доступ простой заменой frontend URL или повторным использованием временного реестра.

## Ограничения запросов

До проверки подписи production применяет минутные buckets в `CacheService` под короткой `ScriptLock`. Для `auth.signIn` разрешено 6 попыток на SHA-256 credential и 60 на deployment; для остальных защищённых запросов — 120 и 300 соответственно. Токен и claims в cache не записываются. Занятая блокировка, повреждённый bucket или недоступный cache приводят к `RATE_LIMITED`; дорогая проверка и Sheets после этого не вызываются.

Это admission control для небольшого закрытого приложения, а не защита на сетевой границе. Apps Script web app не предоставляет приложению надёжный IP клиента, а CacheService может удалить запись до TTL. При публичной регистрации, признаках массового трафика или росте аудитории auth/API переносятся за сервис с edge rate limiting и официальной Google auth library. Квоты Apps Script остаются внешним пределом и контролируются отдельно.

## Браузеры

Цель выпуска — две актуальные стабильные версии Chrome, Edge, Firefox и Safari. Кнопка GIS включает FedCM там, где он поддерживается, и ITP fallback; токен остаётся только в памяти вкладки. Production build с provider/API fixtures проверяется в движках Chromium, Firefox и WebKit, отдельно в мобильном Chromium. Настоящая приёмка Google выполняется с опубликованного HTTPS origin без trace, HAR и записи токена.

Google OAuth client содержит точный Authorized JavaScript origin без пути. Client ID в браузере и `PRODUCTION_GOOGLE_CLIENT_IDS` должны совпадать. Положительный вход, выход, повторный вход, отказ отозванному пользователю и четыре целевых браузера входят в checklist выпуска.

## Основания и пересмотр

- [Google: server-side validation](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) — подпись, `aud`, `iss`, `exp`, ротация ключей и `sub`.
- [Google: setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) — Web Client ID, Authorized JavaScript origins, CSP/COOP.
- [Google: supported browsers](https://developers.google.com/identity/siwg/supported-browsers) — актуальная матрица GIS и FedCM.
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) — изменяемые внешние квоты платформы.

ADR пересматривается при изменении формата Google ID token/JWKS, обновлении криптографической зависимости, расширении аудитории или первом подтверждённом обходе/ложном срабатывании лимита.
