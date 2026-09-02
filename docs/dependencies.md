# Зависимости

Прямые версии закреплены без диапазонов, транзитивные — в package-lock.json. Node 24.14.0/npm 11.9.0 — воспроизводимая базовая среда. Не устанавливаем latest автоматически.

| Группа                     | Выбранные версии | Лицензия   |
| -------------------------- | ---------------- | ---------- |
| React / React DOM          | 19.2.8           | MIT        |
| React Router               | 7.18.3           | MIT        |
| TanStack Query             | 5.102.8          | MIT        |
| Vite / React plugin        | 8.2.2 / 6.1.1    | MIT        |
| Tailwind / Vite plugin     | 4.3.3            | MIT        |
| Zod                        | 4.5.4            | MIT        |
| TypeScript                 | 5.9.3            | Apache-2.0 |
| ESLint / typescript-eslint | 10.9.1 / 8.69.0  | MIT        |
| Vitest / coverage-v8       | 4.1.11           | MIT        |
| Playwright                 | 1.62.1           | Apache-2.0 |
| esbuild                    | 0.28.2           | MIT        |
| clasp                      | 3.4.1            | Apache-2.0 |
| Prettier                   | 3.9.6            | MIT        |

TypeScript 7 не выбран: текущий typescript-eslint заявляет поддержку TypeScript ниже 6.1. Используем совместимую ветку 5.9. Router 7 выбран как стабильная знакомая ветка declarative API. Версии и лицензии проверены по npm metadata при старте.

Установленные транзитивные зависимости clasp могут выводить предупреждения о deprecated-пакетах. Это не равно отчёту об уязвимости; уязвимости отдельно проверяются npm audit.

React Hook Form, Tiptap, dnd-kit, Lucide и PWA-плагины пока не нужны исполняемому коду; подключаются в соответствующих этапах.

## Обновление

1. Проверить release notes, совместимость Node и peer dependencies.
2. Проверить лицензию новой зависимости.
3. Обновить точную версию и lockfile вместе.
4. Выполнить npm ci, check:all, audit:dependencies.
5. Сверить размер начального JS.
6. Major-обновления проводить отдельной задачей и ADR при изменении архитектуры.

## Официальные ориентиры

- [Vite](https://vite.dev/guide/)
- [Tailwind + Vite](https://tailwindcss.com/docs/installation/using-vite)
- [React Router](https://reactrouter.com/start/declarative/installation)
- [Rolldown code splitting](https://rolldown.rs/reference/OutputOptions.codeSplitting)
- [Google clasp](https://developers.google.com/apps-script/guides/clasp)
