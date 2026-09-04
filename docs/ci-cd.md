# CI и выпуск

## Подготовленные workflows

`.github/workflows/ci.yml` запускается на pull request, push в main и вручную:

1. Checkout и Node из .nvmrc, npm 11.9.0.
2. npm ci.
3. npm run check: формат, lint, архитектура/циклы, типы, coverage, обе сборки, bundle budgets.
4. Установка Chromium, Firefox и WebKit; Playwright smoke и production auth fixtures.
5. Сохранение coverage, отчётов браузера и сборок на 7 дней.

Job имеет read-only доступ к содержимому репозитория; Google credentials ему не нужны. Повторный push отменяет устаревшую проверку той же ветки.

`dependency-audit.yml` отдельно проверяет известные npm-уязвимости по понедельникам и вручную. Сетевой audit вынесен из основного offline-capable цикла.

Репозиторий: [Kaerna-Group/tastory](https://github.com/Kaerna-Group/tastory). Результаты облачных проверок доступны в [GitHub Actions](https://github.com/Kaerna-Group/tastory/actions). Проверенные локальные результаты записываются в changelog.

## Подключение репозитория

Origin: `git@github.com-personal:Kaerna-Group/tastory.git`. SSH-алиас `github.com-personal` использует личный ключ владельца. Для нового компьютера настройте такой же алиас или используйте обычный адрес `git@github.com:Kaerna-Group/tastory.git` с соответствующим ключом.

В локальной конфигурации этого репозитория закреплены `user.name=Ermolz`, `user.email=00ermzahar@gmail.com` и `user.useConfigOnly=true`. И автор, и создатель коммитов — владелец; дополнительные соавторы автоматически не добавляются. Глобальная конфигурация других проектов не менялась.

Первичная основа опубликована в main коммитом `3bd468b`; локальная ветка отслеживает origin/main. Дальнейшие изменения рекомендуется вести через короткие feature branches и PR. Защита main и обязательные проверки на стороне GitHub пока не включены; это отдельная настройка рабочего процесса.

## Развёртывание

Для проверки этапа 0 опубликован [**staging** на GitHub Pages](https://kaerna-group.github.io/tastory/) со статическим dist. HashRouter поддерживает переходы без server rewrites. Для project Pages используется `VITE_BASE_PATH=/tastory/`; workflow получает base path из configure-pages.

Workflow **Publish staging** запускается вручную из main, выполняет quality и smoke перед публикацией, затем проверяет настоящий HTTPS origin в браузерах. Это необходимая часть технического spike. [Настройка и повторный запуск](staging-hosting.md).

**Verify Safari staging** отдельно проверяет уже опубликованный сайт в настоящем Safari на macOS. Для полного транспортного прогона нужны оба workflow и включённый echo; первые обязательные проверки успешно завершены.

Перед выпуском production:

- завершить gate этапа 0;
- настроить отдельные staging/prod Google-ресурсы;
- создать GitHub Environments, production — с required reviewer;
- собрать web с соответствующим env, проверить asset paths и реальный health;
- Apps Script сначала проверять на staging, затем создавать версию и обновлять существующий deployment;
- иметь предыдущую рабочую версию для rollback.

Обычный CI собирает mock shell и ничего не публикует. Отдельный Publish staging собирает настоящий staging API; автоматического production deploy нет.
