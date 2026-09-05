# CI и выпуск

## Подготовленные workflows

`.github/workflows/ci.yml` запускается на pull request, push в main и вручную:

1. Checkout и Node из .nvmrc, npm 11.9.0.
2. npm ci.
3. npm run check: формат, lint, архитектура/циклы, типы, coverage, обе сборки, bundle budgets.
4. Coverage и обе сборки сохраняются на 7 дней.

Обычный CI намеренно не устанавливает браузеры и не запускает Playwright, PDF, визуальную матрицу
или многократные проверки стабильности. Полный набор не удалён: перед выпуском он выполняется на
рабочем компьютере командой `npm run check:all`. Для более короткого локального цикла доступны
`npm run test:e2e`, `npm run test:auth`, `npm run test:auth:n4` и
`npm run test:auth:history-stability`. Целевые стабильностные прогоны используют `retries=0`, чтобы
ошибка не скрывалась успешным повтором.

Job имеет read-only доступ к содержимому репозитория; Google credentials ему не нужны. Повторный push отменяет устаревшую проверку той же ветки.

`dependency-audit.yml` отдельно проверяет известные npm-уязвимости по понедельникам и вручную. Сетевой audit вынесен из основного offline-capable цикла.

Репозиторий: [Kaerna-Group/tastory](https://github.com/Kaerna-Group/tastory). Результаты облачных проверок доступны в [GitHub Actions](https://github.com/Kaerna-Group/tastory/actions). Проверенные локальные результаты записываются в changelog.

## Подключение репозитория

Origin: `git@github.com-personal:Kaerna-Group/tastory.git`. SSH-алиас `github.com-personal` использует личный ключ владельца. Для нового компьютера настройте такой же алиас или используйте обычный адрес `git@github.com:Kaerna-Group/tastory.git` с соответствующим ключом.

В локальной конфигурации этого репозитория закреплены `user.name=Ermolz`, `user.email=00ermzahar@gmail.com` и `user.useConfigOnly=true`. И автор, и создатель коммитов — владелец; дополнительные соавторы автоматически не добавляются. Глобальная конфигурация других проектов не менялась.

Первичная основа опубликована в main коммитом `3bd468b`; локальная ветка отслеживает origin/main. Дальнейшие изменения рекомендуется вести через короткие feature branches и PR. Защита main и обязательные проверки на стороне GitHub пока не включены; это отдельная настройка рабочего процесса.

## Развёртывание

Для проверки этапа 0 опубликован [**staging** на GitHub Pages](https://kaerna-group.github.io/tastory/) со статическим dist. HashRouter поддерживает переходы без server rewrites. Для project Pages используется `VITE_BASE_PATH=/tastory/`; workflow получает base path из configure-pages.

Workflow **Publish staging** запускается вручную из main, выполняет быстрый quality gate, собирает и
публикует web, затем без браузера проверяет HTML, входной JavaScript и публичный backend health.
Playwright и PDF в этом workflow не запускаются. [Настройка и повторный запуск](staging-hosting.md).

**Verify Safari staging** — исключительная ручная приёмка уже опубликованного сайта в настоящем
Safari на macOS. Она никогда не запускается автоматически и используется только по отдельному
решению перед выпуском, когда требуется доказательство именно для Safari.

## Краткий checklist выпуска

Каждый пункт записывается в отчёт конкретного выпуска фактическим значением, а не только отметкой:

- [ ] **Frontend SHA:** SHA опубликованного Pages artifact совпадает с проверенным commit.
- [ ] **Backend:** записаны immutable Apps Script version и `health.deploymentVersion`; отдельно
      перечислены реально проверенные capabilities. Совпадение frontend SHA само по себе версию или
      возможности backend не подтверждает.
- [ ] **Schema:** авторизованный `admin.health` подтверждает ожидаемые `schemaVersion: 9` и
      `tablesChecked: 25`; в `SchemaMigrations` подтверждены записи `008-recipe-templates` и
      `009-recipe-designs` с ожидаемыми контрольными суммами.
- [ ] **Резервная копия:** до согласованной миграции создана и проверена пригодная для восстановления
      копия текущей книги; её идентификатор и время проверки записаны.
- [ ] **Миграции 008/009:** результат каждой отмечен как `не запускалась`, `applied` или
      `already-applied` и
      приложен отдельный отчёт. Запуск требует отдельного согласования: вход владельцем в приложение
      может автоматически инициировать `admin.recipes.initialize`, поэтому такой вход нельзя
      использовать как безобидную live-проверку до решения о миграции.
- [ ] **Rollback:** сохранены предыдущие рабочие frontend SHA и Apps Script version.

`Publish staging` в `.github/workflows/staging-pages.yml` развёртывает только web artifact на GitHub
Pages. Он не загружает, не версионирует и не переключает Apps Script deployment; backend выпускается
и проверяется отдельной операцией.

Перед production дополнительно завершаются gate этапа, настраиваются отдельные staging/prod
Google-ресурсы и GitHub Environment с required reviewer.

### Неподтверждённые live-проверки

До отдельного запуска их следует оставлять открытыми, даже если code и CI зелёные:

- [ ] опубликованный Pages действительно обслуживает записанный frontend SHA;
- [ ] текущий `/exec` указывает на записанную Apps Script version и возвращает ожидаемый
      `deploymentVersion`;
- [ ] реальные backend capabilities соответствуют frontend этого выпуска;
- [ ] `admin.health` настоящей книги подтверждает schema 9 и 25 таблиц;
- [ ] миграции `008-recipe-templates` и `009-recipe-designs` подтверждены отдельно и не были неявно
      запущены входом владельца;
- [ ] резервная копия настоящей книги создана, проверена и доступна для восстановления.

Обычный CI собирает mock shell и ничего не публикует. Отдельный Publish staging собирает настоящий staging API; автоматического production deploy нет.
