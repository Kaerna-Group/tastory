# ADR 0003: HashRouter для статического размещения

Дата: 2026-09-02  
Статус: принято

## Контекст

Планируется GitHub Pages без серверных SPA rewrites. Обновление вложенного pathname иначе ведёт к 404.

## Решение

Использовать React Router HashRouter: /#/ и /#/settings. Base path ассетов задаётся Vite через VITE_BASE_PATH. Настройки загружаются лениво.

## Альтернативы

BrowserRouter требует rewrite или 404-redirect workaround. Router framework/SSR не нужен закрытому приложению на этом этапе.

## Последствия

Ссылки содержат hash, но работают после обновления на статическом хостинге. Skip link фокусирует main программно, чтобы не менять hash-маршрут.

## Пересмотр

Переход на хостинг с SPA fallback или необходимость чистых pathname URL.
