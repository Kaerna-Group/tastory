# Оформление Tastory

Название: **Tastory**. Слоган: **Every recipe has a story.**

Знак — раскрытая книга рецептов с ложкой. Цвета взяты из интерфейса: розовый `#B9576B`, бумага `#F4EFE7`, светлая поверхность `#FFFDF8`, текст `#302A25`. В интерфейсе знак сочетается с текстовым логотипом, который сохраняет читаемость в обеих темах.

## Файлы

Все готовые файлы находятся в `apps/web/public` и копируются в web-сборку:

- `brand/mark.svg` — векторный знак, также используется как favicon.
- `brand/wordmark.svg` — горизонтальный логотип для светлого фона.
- `favicon.ico`, `favicon-32.png` — иконка вкладки 32×32.
- `apple-touch-icon.png` — иконка 180×180 для Apple.
- `icon-192.png`, `icon-512.png`, `site.webmanifest` — имя и иконки приложения для поддерживающих manifest браузеров. Офлайн-режим не добавлен.
- `brand/social-preview.png` — карточка ссылки 1280×640, пригодная и для GitHub Social preview.
- `brand/social-preview.svg` — редактируемый исходник карточки. После редактирования экспортируйте PNG 1280×640 с тем же именем; исходник использует Georgia и Segoe UI.

![Tastory — Every recipe has a story.](../apps/web/public/brand/social-preview.png)

## Превью ссылки на сайт

Карточка называется **Open Graph preview** (OG-превью). В HTML при сборке добавляются название, описание, PNG-картинка и её размеры; Twitter Card использует ту же картинку. Данные доступны без запуска React. [Спецификация Open Graph](https://ogp.me/).

`VITE_SITE_URL` задаёт полный публичный адрес сайта, включая путь. По умолчанию используется `https://kaerna-group.github.io/tastory/`. Для другого домена или каталога задайте значение при сборке, например `https://recipes.example.com/`. Адрес должен быть HTTPS, без параметров, фрагмента и учётных данных. Он используется для canonical, `og:url` и абсолютных ссылок на PNG.

`VITE_BASE_PATH` отдельно управляет путями файлов приложения. Иконки и manifest учитывают этот путь; ссылки внутри manifest относительные. При переносе сайта обновите обе настройки.

Карточка станет доступна мессенджерам после публикации новой сборки. Уже отправленные ссылки могут показывать кешированную карточку. Hash-маршруты приложения используют общую карточку Tastory.

## Превью ссылки на GitHub-репозиторий

Настройка сайта не меняет карточку ссылки вида `github.com/Kaerna-Group/tastory`. Для неё загрузите `apps/web/public/brand/social-preview.png` в настройках репозитория: **Settings → General → Social preview → Edit → Upload an image**. Изображение подготовлено; загрузка в настройках GitHub выполняется отдельно. [Инструкция GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).
