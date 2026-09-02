import { Link } from 'react-router';
export function NotFoundPage(): React.JSX.Element {
  return (
    <section className="panel mt-12">
      <p className="eyebrow">404</p>
      <h1>Страница не найдена</h1>
      <p className="muted my-5">Кажется, этот лист ещё не написан.</p>
      <Link className="text-link" to="/">
        Вернуться в библиотеку
      </Link>
    </section>
  );
}
