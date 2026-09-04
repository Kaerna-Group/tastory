import { useEffect } from 'react';
import type { RecipeDraftValue, Tag } from '../model/drafts';

type Props = {
  value: RecipeDraftValue;
  onChange: (value: RecipeDraftValue) => void;
  tags: Tag[];
  disabled: boolean;
  unitSystem: 'metric' | 'imperial';
  keyboardShortcuts: boolean;
};
const numeric = (value: string) => (value === '' ? null : Number(value));
export function RecipeFields({
  value,
  onChange,
  tags,
  disabled,
  unitSystem,
  keyboardShortcuts,
}: Props) {
  const content = <K extends keyof RecipeDraftValue['content']>(
    key: K,
    next: RecipeDraftValue['content'][K],
  ) => onChange({ ...value, content: { ...value.content, [key]: next } });
  const addIngredient = () =>
    onChange({
      ...value,
      ingredients: [
        ...value.ingredients,
        {
          key: crypto.randomUUID(),
          sectionTitle: '',
          position: value.ingredients.length,
          name: '',
          quantityValue: null,
          quantityText: '',
          unit: '',
          note: '',
          isOptional: false,
        },
      ],
    });
  const addStep = () =>
    onChange({
      ...value,
      steps: [
        ...value.steps,
        {
          key: crypto.randomUUID(),
          sectionTitle: '',
          position: value.steps.length,
          body: '',
          durationSeconds: null,
        },
      ],
    });
  useEffect(() => {
    if (!keyboardShortcuts || disabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey) return;
      if (event.key.toLowerCase() === 'i' && value.ingredients.length < 200) {
        event.preventDefault();
        addIngredient();
      }
      if (event.key.toLowerCase() === 's' && value.steps.length < 100) {
        event.preventDefault();
        addStep();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const units =
    unitSystem === 'metric'
      ? ['г', 'кг', 'мл', 'л', 'шт.', 'ч. л.', 'ст. л.']
      : ['oz', 'lb', 'fl oz', 'cup', 'tsp', 'tbsp', 'шт.'];
  return (
    <fieldset className="recipe-fields" disabled={disabled}>
      <legend className="sr-only">Содержание рецепта</legend>
      <datalist id="recipe-unit-suggestions">
        {units.map((unit) => (
          <option value={unit} key={unit} />
        ))}
      </datalist>
      <section className="panel recipe-section">
        <label>
          Название
          <input
            value={value.content.title}
            maxLength={200}
            placeholder="Например, яблочный пирог"
            onChange={(e) => content('title', e.target.value)}
          />
        </label>
        <label>
          Описание
          <textarea
            rows={3}
            value={value.content.description}
            maxLength={4000}
            placeholder="Что делает этот рецепт особенным?"
            onChange={(e) => content('description', e.target.value)}
          />
        </label>
        <div className="recipe-columns">
          <label>
            Порций
            <input
              type="number"
              min="0.01"
              max="100000"
              step="any"
              value={value.content.servings ?? ''}
              onChange={(e) => content('servings', numeric(e.target.value))}
            />
          </label>
          <label>
            Подготовка, мин
            <input
              type="number"
              min="0"
              max="525600"
              value={value.content.prepMinutes ?? ''}
              onChange={(e) => content('prepMinutes', numeric(e.target.value))}
            />
          </label>
          <label>
            Приготовление, мин
            <input
              type="number"
              min="0"
              max="525600"
              value={value.content.cookMinutes ?? ''}
              onChange={(e) => content('cookMinutes', numeric(e.target.value))}
            />
          </label>
        </div>
      </section>
      <section className="panel recipe-section" aria-labelledby="ingredients-title">
        <h2 id="ingredients-title">Ингредиенты</h2>
        {value.ingredients.length === 0 && (
          <p className="muted">Добавьте продукты и их количество.</p>
        )}
        {value.ingredients.map((row, index) => {
          const update = (patch: Partial<typeof row>) =>
            onChange({
              ...value,
              ingredients: value.ingredients.map((item) =>
                item.key === row.key ? { ...item, ...patch } : item,
              ),
            });
          return (
            <div className="recipe-row" key={row.key}>
              <div className="recipe-columns ingredient-columns">
                <label>
                  Ингредиент {index + 1}
                  <input
                    value={row.name}
                    maxLength={200}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label>
                  Количество
                  <input
                    aria-label={`Количество ингредиента ${index + 1}`}
                    value={row.quantityText || (row.quantityValue ?? '')}
                    maxLength={100}
                    placeholder="200 или по вкусу"
                    onChange={(e) => update({ quantityText: e.target.value, quantityValue: null })}
                  />
                </label>
                <label>
                  Единица
                  <input
                    aria-label={`Единица ингредиента ${index + 1}`}
                    value={row.unit}
                    list="recipe-unit-suggestions"
                    maxLength={50}
                    placeholder="г, мл, шт."
                    onChange={(e) => update({ unit: e.target.value })}
                  />
                </label>
              </div>
              <details>
                <summary>Раздел и примечание</summary>
                <div className="recipe-columns">
                  <label>
                    Раздел
                    <input
                      value={row.sectionTitle}
                      maxLength={200}
                      onChange={(e) => update({ sectionTitle: e.target.value })}
                    />
                  </label>
                  <label>
                    Примечание
                    <input
                      value={row.note}
                      maxLength={1000}
                      onChange={(e) => update({ note: e.target.value })}
                    />
                  </label>
                  <label className="recipe-check">
                    <input
                      type="checkbox"
                      checked={row.isOptional}
                      onChange={(e) => update({ isOptional: e.target.checked })}
                    />
                    Необязательно
                  </label>
                </div>
              </details>
              <div className="recipe-row-actions">
                <button
                  type="button"
                  className="text-link"
                  disabled={index === 0}
                  aria-label={`Поднять ингредиент ${index + 1}`}
                  onClick={() => {
                    const rows = [...value.ingredients];
                    const previous = rows[index - 1];
                    if (previous) {
                      rows[index - 1] = row;
                      rows[index] = previous;
                      onChange({ ...value, ingredients: rows });
                    }
                  }}
                >
                  ↑ Выше
                </button>
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Удалить ингредиент ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      ingredients: value.ingredients.filter((item) => item.key !== row.key),
                    })
                  }
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="button button-secondary"
          disabled={value.ingredients.length >= 200}
          onClick={addIngredient}
        >
          Добавить ингредиент
        </button>
      </section>
      <section className="panel recipe-section" aria-labelledby="steps-title">
        <h2 id="steps-title">Приготовление</h2>
        {value.steps.length === 0 && <p className="muted">Опишите приготовление по шагам.</p>}
        {value.steps.map((row, index) => {
          const update = (patch: Partial<typeof row>) =>
            onChange({
              ...value,
              steps: value.steps.map((item) =>
                item.key === row.key ? { ...item, ...patch } : item,
              ),
            });
          return (
            <div className="recipe-row" key={row.key}>
              <label>
                Шаг {index + 1}
                <textarea
                  rows={4}
                  value={row.body}
                  maxLength={10000}
                  onChange={(e) => update({ body: e.target.value })}
                />
              </label>
              <details>
                <summary>Раздел и время шага</summary>
                <div className="recipe-columns">
                  <label>
                    Раздел
                    <input
                      value={row.sectionTitle}
                      maxLength={200}
                      onChange={(e) => update({ sectionTitle: e.target.value })}
                    />
                  </label>
                  <label>
                    Время, секунд
                    <input
                      type="number"
                      min="0"
                      max="31536000"
                      value={row.durationSeconds ?? ''}
                      onChange={(e) => update({ durationSeconds: numeric(e.target.value) })}
                    />
                  </label>
                </div>
              </details>
              <div className="recipe-row-actions">
                <button
                  type="button"
                  className="text-link"
                  disabled={index === 0}
                  aria-label={`Поднять шаг ${index + 1}`}
                  onClick={() => {
                    const rows = [...value.steps];
                    const previous = rows[index - 1];
                    if (previous) {
                      rows[index - 1] = row;
                      rows[index] = previous;
                      onChange({ ...value, steps: rows });
                    }
                  }}
                >
                  ↑ Выше
                </button>
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Удалить шаг ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      steps: value.steps.filter((item) => item.key !== row.key),
                    })
                  }
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="button button-secondary"
          disabled={value.steps.length >= 100}
          onClick={addStep}
        >
          Добавить шаг
        </button>
      </section>
      <section className="panel recipe-section">
        <h2>Детали</h2>
        <fieldset className="recipe-tag-list">
          <legend>Теги</legend>
          {tags
            .filter((tag) => tag.status === 'active' || value.tagIds.includes(tag.id))
            .map((tag) => (
              <label className="recipe-check" key={tag.id}>
                <input
                  type="checkbox"
                  checked={value.tagIds.includes(tag.id)}
                  disabled={!value.tagIds.includes(tag.id) && value.tagIds.length >= 30}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      tagIds: e.target.checked
                        ? [...value.tagIds, tag.id]
                        : value.tagIds.filter((id) => id !== tag.id),
                    })
                  }
                />
                {tag.name}
                {tag.status === 'archived' ? ' (в архиве)' : ''}
              </label>
            ))}
          {tags.length === 0 && <p className="muted">В тетради пока нет доступных тегов.</p>}
        </fieldset>
        <label>
          Источник
          <input
            type="url"
            value={value.content.sourceUrl}
            maxLength={2048}
            placeholder="https://…"
            onChange={(e) => content('sourceUrl', e.target.value)}
          />
        </label>
        <label>
          Личные заметки
          <textarea
            rows={4}
            value={value.content.notes}
            maxLength={10000}
            onChange={(e) => content('notes', e.target.value)}
          />
        </label>
        <p className="muted text-sm">Заметки доступны автору и владельцу тетради.</p>
      </section>
    </fieldset>
  );
}
