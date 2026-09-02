# ADR 0004: проверка Google ID token в Apps Script staging

Дата: 2026-09-03. Статус: **эксперимент для staging; production-решение не принято**.

## Контекст

Blueprint предлагает серверную проверку через general-purpose JWT library. Apps Script V8 не предоставляет WebCrypto, поэтому обычная сборка современного `jose` здесь не работает. Популярный совместимый `jsrsasign` объявлен неподдерживаемым. Добавлять его как долгосрочную основу нового auth-модуля не выбрано. [Ограничения V8](https://developers.google.com/apps-script/guides/v8-runtime), [объявление jsrsasign](https://github.com/kjur/jsrsasign#end-of-support-announcement-for-jsrsasign).

## Экспериментальное решение

Для ограниченного spike используем `micro-rsa-dsa-dh` 0.4.0: только `PKCS1_SHA256.verify`, только открытые Google JWK RSA 2048–4096 бит с exponent 65537. SHA-256 и RSA/padding реализует библиотека. Собственных RSA, padding, SHA и генерации ключей в приложении нет. Секретные ключи на сервере не используются. [Исходный проект и ограничения](https://github.com/paulmillr/micro-rsa-dsa-dh).

Это **не general-purpose JWT library**: формат и Google claims проверяет ограниченный адаптер на Zod. Это осознанное отличие от blueprint, только для проверки платформы. Модуль закрыт для `APP_ENV != staging`; включение production не является продолжением этого решения автоматически. До закрытия архитектурного gate нужно отдельно рассмотреть поддержку, аудит зависимости и стоимость сопровождения claims-адаптера; при неприемлемом результате вынести верификацию в сервер с официальной Google auth library или поддерживаемой JWT library.

Фиксированный endpoint `https://www.googleapis.com/oauth2/v3/certs`, ограниченный кеш с refresh-lock, разрешённые audiences из Script Properties. Ключи, URLs, алгоритмы и роли из входящего JWT не используются как настройки сервера. Ни декодирования без проверки подписи, ни production fallback через tokeninfo нет.

## Доступ и хранение

GIS использует popup callback. Приложение передаёт ID token в JSON body как bearer credential через существующий text/plain transport без cookies. HTTP endpoint не меняет сессию браузера через cookie или redirect. Сессия клиента хранится в памяти и очищается по expiry/выходу. Каждый защищённый запрос проверяет credential и текущую политику приглашений. Origin/CORS не заменяют эту проверку.

Для 10 тестовых аккаунтов временная policy `STAGING_INVITES` и потреблённые привязки `STAGING_AUTH_BINDINGS` находятся в Script Properties. Привязка создаётся одним setProperty под ScriptLock, `auth.me` никогда не регистрирует нового пользователя. Исчезновение invitation означает отзыв, сохранённый `sub` предотвращает захват потреблённого приглашения другим аккаунтом. Role перечитывается при каждом запросе. Время жизни invitation ограничивает первое потребление; expiry ID token проверяется независимо.

Автоматический первый допуск по email разрешён только для Gmail/Workspace. Для сторонних адресов понадобится дополнительное подтверждение владения. [Google: проверка ID token и авторитетность email](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Доказательства и оставшиеся условия

Положительная проверка RSA-подписи, отрицательные токены и приглашения проверяются тестами; собранный IIFE выполняет те же операции в VM без Node/browser/WebCrypto. Это проверка совместимости, не криптографический аудит. Отсутствие npm audit findings также не равно аудиту криптографии.

Реальный Google OAuth client, owner consent, вход/выход/отзыв с HTTPS Pages и повторение в браузерах обязательны для закрытия S0-04/S0-05. Широкие эксплуатационные лимиты, полноценный RBAC, audit trail и миграция Users/Invites относятся к следующим этапам. Публичный auth endpoint Apps Script остаётся под общими квотами платформы; защиту от массового трафика следует оценить до production.

При загрузке 2026-09-03 Apps Script API отклонил bigint-литерал `65537n` с ParseError; вариант `BigInt(65537)` принят. Сборка проверяет отсутствие bigint-литералов по AST, сохраняя допустимые текстовые строки сторонних библиотек. Успешная загрузка подтверждает принятие синтаксиса, но не заменяет реальное исполнение auth в Google.
