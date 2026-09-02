import { Link } from 'react-router';
export function LibraryPage(): React.JSX.Element {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">Место для вкусных историй</p>
        <h1>Ваша кулинарная тетрадь</h1>
        <p className="muted">
          Любимые блюда, маленькие секреты и рецепты, к которым хочется возвращаться.
        </p>
      </div>
      <section className="notebook" aria-labelledby="empty-title">
        <span className="notebook-tab" aria-hidden="true">
          01
        </span>
        <div className="book-mark" aria-hidden="true">
          t.
        </div>
        <p className="eyebrow">Первая страница</p>
        <h2 id="empty-title">Всё начинается с одного рецепта</h2>
        <p className="muted mx-auto max-w-lg">
          Тетрадь пока пуста. Мы готовим место, где можно будет бережно собирать ваши любимые
          рецепты и оформлять их по-своему.
        </p>
        <span className="stage-label">Создание рецептов — в следующем этапе</span>
      </section>
      <div className="library-footer">
        <p className="muted text-sm">Tastory · начало вашей коллекции</p>
        <Link className="text-link" to="/settings">
          Настройки тетради <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </>
  );
}
