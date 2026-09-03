# Архитектура

## Границы

```text
React UI → API client → Apps Script controllers → services → repositories/storage
              ↓                    ↓
          contracts            contracts/domain
```

Backend содержит миграции схемы 1/2, Google auth с пользователями и членством в Sheets, управление приглашениями/правами, журнал и аудит, диагностику и принятую пробу приватного фото через Drive. Следующий слой — модель и repositories рецептов. [Ограничения пробы фото](google-photos-staging.md) не являются моделью хранения рецептов.

Общие пакеты имеют единственный TypeScript public API, не публикуются в npm и собираются потребляющим приложением. Между ними пока нет зависимостей.

- **contracts**: runtime-схемы, DTO, версии и ошибки; runtime-зависимость — Zod.
- **domain**: чистые функции без DTO, DOM, Node и Google; начальное правило — проверка и расчёт времени рецепта.
- **design-tokens**: CSS-переменные палитры blueprint и допустимые режимы темы. Конструктор пользовательских тем появится позже.
- **web**: адаптация DTO в представление, маршрутизация, состояние UI.
- **apps-script**: валидация, адаптеры Google, авторизация и хранение текущих системных сущностей; затем рецепты и их связи.

## FSD

```text
app → pages → widgets → features → entities → shared
```

- Между слайсами — только вниз по слоям.
- Другой слайс того же слоя не импортируется.
- Внутри слайса — относительные пути; между слайсами — `@/`.
- Внешний код использует `index.ts`/`index.tsx`, без deep imports и `export *`.
- App/shared не содержат бизнес-слайсов; сегменты shared могут обращаться друг к другу.
- Domain доступен model-сегментам entities/features, contracts — api/model либо bootstrap.
- React не знает имена листов, номера строк, Drive IDs и Google service objects.
- Widgets/entities наполняются по реальным задачам.

`npm run lint:architecture` строит граф статических и литеральных динамических TS-импортов, проверяет границы, public API и циклы, включая type imports. Нелитеральные dynamic imports запрещены. CSS не входит в граф. Исключения `@x` пока не поддерживаются: для их введения нужен ADR и тест правила.

## Web

Маршруты: `/#/`, `/#/settings`, fallback 404. HashRouter выбран для статического размещения без server rewrites.

Settings загружается отдельно. TanStack Query хранит health-состояние, React — тему. Транспорт инъецируется в клиент; mock проходит те же Zod-схемы, что backend. Ответ связывается с requestId.

Health query преобразует DTO в модель отображения. Рецепты, макеты, темы страниц и стикеры будут разными сущностями.

## Apps Script

Entry points формируют TextOutput; controller валидирует вход и возвращает envelope; platform предоставляет время, UUID и Script Properties. Тесты подставляют контекст без Google API.

Esbuild выпускает IIFE и глобальные doGet/doPost. Сборка выполняет их в изолированном JS-контексте с заглушками Google, без Node/browser API. Это проверка bundle, а не совместимости настоящего Apps Script.
