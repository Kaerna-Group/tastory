import { buildRecipePageDocument } from '../model/page-document';
import type {
  RecipePageFragment,
  RecipePageRenderOptions,
  RecipeRenderedPage,
} from '../model/page-document';
import './recipe-page-renderer.css';

export type RecipePageRendererProps = RecipePageRenderOptions &
  Readonly<{
    value: Parameters<typeof buildRecipePageDocument>[0];
    compact?: boolean;
    coverImageSource?: string;
  }>;

function PageList({
  items,
  kind,
}: {
  items: readonly RecipePageFragment[];
  kind: 'ingredient' | 'step';
}) {
  if (!items.length)
    return (
      <p className="recipe-page-empty">
        {kind === 'ingredient' ? 'Добавьте продукты' : 'Добавьте шаги'}
      </p>
    );
  return (
    <ol className={`recipe-page-list recipe-page-list-${kind}`}>
      {items.map((item) => (
        <li key={item.key} data-continuation={item.continuation || undefined}>
          <span className="recipe-page-list-mark" aria-hidden="true">
            {item.continuation ? '↳' : kind === 'ingredient' ? '•' : item.sourceIndex + 1}
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

function RecipeSheet({
  page,
  layout,
  compact,
  totalMinutes,
  servings,
  coverImageSource,
}: {
  page: RecipeRenderedPage;
  layout: RecipePageRenderOptions['layout'];
  compact: boolean;
  totalMinutes: number | null;
  servings: number | null;
  coverImageSource?: string;
}) {
  const opening = page.kind === 'opening';
  const narrative = page.kind === 'story' || page.kind === 'notes';
  return (
    <article
      className={`template-recipe-page recipe-page-sheet${compact ? ' template-recipe-page-compact' : ''}`}
      data-layout={layout}
      data-page-kind={page.kind}
      aria-label={`Страница ${page.number}: ${page.title}`}
    >
      <span className="recipe-page-number">{String(page.number).padStart(2, '0')}</span>
      <div className="template-page-mark" aria-hidden="true">
        {layout === 'coffeehouse' ||
        layout === 'tea-ceremony' ||
        layout === 'cocktail-night' ||
        layout === 'fresh-bar' ||
        layout === 'wine-cellar'
          ? '◌'
          : '✦'}
      </div>
      <header>
        <p className="template-page-kicker">{page.kicker}</p>
        <h3>{opening ? page.title : `${page.title} — продолжение`}</h3>
        {opening && page.description && <p>{page.description}</p>}
      </header>
      {opening && (
        <div className="template-page-meta">
          <span>{servings === null ? 'Для близких' : `${servings} порц.`}</span>
          <span>{totalMinutes === null ? 'В своём ритме' : `${totalMinutes} мин.`}</span>
        </div>
      )}
      {opening && coverImageSource && (
        <figure className="recipe-page-cover">
          <img src={coverImageSource} alt="Главная фотография рецепта" />
        </figure>
      )}
      {narrative ? (
        <section className="recipe-page-narrative">
          <h4>{page.kind === 'notes' ? 'Заметки' : 'История рецепта'}</h4>
          <p>{page.narrative}</p>
        </section>
      ) : (
        <div className="template-page-columns">
          <section>
            <h4>{opening ? 'Ингредиенты' : 'Ингредиенты · продолжение'}</h4>
            <PageList items={page.ingredients} kind="ingredient" />
          </section>
          <section>
            <h4>{opening ? 'Приготовление' : 'Приготовление · продолжение'}</h4>
            <PageList items={page.steps} kind="step" />
          </section>
        </div>
      )}
      {(page.tags.length > 0 || page.sourceUrl) && (
        <footer className="recipe-page-footer">
          {page.tags.length > 0 && <span>{page.tags.join(' · ')}</span>}
          {page.sourceUrl && <span>Источник сохранён в рецепте</span>}
        </footer>
      )}
    </article>
  );
}

export function RecipePageRenderer(props: RecipePageRendererProps) {
  const model = buildRecipePageDocument(props.value, {
    ...props,
    hasCover: Boolean(props.coverImageSource),
  });
  const pages = props.compact ? model.pages.slice(0, 1) : model.pages;
  return (
    <div className={`recipe-page-spread${props.compact ? ' recipe-page-spread-compact' : ''}`}>
      {!props.compact && model.hasLongContent && (
        <p className="recipe-page-flow-note" role="status">
          Длинный рецепт аккуратно продолжен: {model.pages.length} стр.
        </p>
      )}
      {pages.map((page) => (
        <RecipeSheet
          key={page.id}
          page={page}
          layout={props.layout}
          compact={Boolean(props.compact)}
          totalMinutes={model.totalMinutes}
          servings={model.servings}
          coverImageSource={page.kind === 'opening' ? (props.coverImageSource ?? '') : ''}
        />
      ))}
    </div>
  );
}
