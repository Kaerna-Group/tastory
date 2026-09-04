import type { RecipeSummary } from '@tastory/contracts';

export type LibraryView = 'grid' | 'list';
export type LibrarySort = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc';
export type LibraryStatus = 'current' | 'archived' | 'all';
export type LibraryVisibility = 'all' | 'private' | 'workspace';
export type LibraryQuery = {
  q: string;
  status: LibraryStatus;
  visibility: LibraryVisibility;
  tag: string;
  favorite: boolean;
  sort: LibrarySort;
  view: LibraryView;
};

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru').trim();
const oneOf = <T extends string>(value: string | null, values: readonly T[], fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

export function readLibraryQuery(search: URLSearchParams): LibraryQuery {
  return {
    q: search.get('q')?.slice(0, 100) ?? '',
    status: oneOf(search.get('status'), ['current', 'archived', 'all'], 'current'),
    visibility: oneOf(search.get('visibility'), ['all', 'private', 'workspace'], 'all'),
    tag: search.get('tag') ?? '',
    favorite: search.get('favorite') === '1',
    sort: oneOf(
      search.get('sort'),
      ['updated-desc', 'updated-asc', 'title-asc', 'title-desc'],
      'updated-desc',
    ),
    view: oneOf(search.get('view'), ['grid', 'list'], 'grid'),
  };
}

export function writeLibraryQuery(query: LibraryQuery): URLSearchParams {
  const result = new URLSearchParams();
  if (query.q) result.set('q', query.q);
  if (query.status !== 'current') result.set('status', query.status);
  if (query.visibility !== 'all') result.set('visibility', query.visibility);
  if (query.tag) result.set('tag', query.tag);
  if (query.favorite) result.set('favorite', '1');
  if (query.sort !== 'updated-desc') result.set('sort', query.sort);
  if (query.view !== 'grid') result.set('view', query.view);
  return result;
}

export function selectLibraryRecipes(
  recipes: readonly RecipeSummary[],
  query: LibraryQuery,
): RecipeSummary[] {
  const terms = normalize(query.q).split(/\s+/).filter(Boolean);
  const visible = recipes.filter((recipe) => {
    const haystack = normalize([recipe.title, ...recipe.ingredientNames].join(' '));
    return (
      terms.every((term) => haystack.includes(term)) &&
      (query.status === 'all' ||
        (query.status === 'archived'
          ? recipe.status === 'archived'
          : recipe.status !== 'archived')) &&
      (query.visibility === 'all' || recipe.visibility === query.visibility) &&
      (!query.tag || recipe.tags.some((tag) => tag.id === query.tag)) &&
      (!query.favorite || recipe.favorite)
    );
  });
  const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
  return visible.sort((a, b) => {
    if (query.sort === 'title-asc') return collator.compare(a.title, b.title);
    if (query.sort === 'title-desc') return collator.compare(b.title, a.title);
    const difference = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return query.sort === 'updated-asc' ? difference : -difference;
  });
}
