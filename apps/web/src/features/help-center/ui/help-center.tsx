import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getUserSettings, subscribeUserSettings } from '@/entities/user-settings';

const editing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.matches('input, textarea, select') || target.isContentEditable);

export function HelpCenter(): React.JSX.Element {
  const { settings } = useSyncExternalStore(subscribeUserSettings, getUserSettings);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (settings.keyboardShortcuts && event.key === '?' && !editing(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [settings.keyboardShortcuts]);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="help-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Справка <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="help-title">Как работать с Tastory</h2>
              <button
                ref={closeRef}
                type="button"
                className="icon-button"
                aria-label="Закрыть справку"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <h3>Сохранение</h3>
            <p>
              Редактор сначала сохраняет черновик в браузере, затем отправляет изменения в тетрадь.
              При конфликте исходные данные остаются доступными.
            </p>
            <h3>Фото и файлы</h3>
            <p>
              Обложка, галерея и фото шагов хранятся в закрытой папке книги. Потерянные файлы можно
              найти в настройках.
            </p>
            <h3>Перенос данных</h3>
            <p>
              Экспорт создаёт файл Tastory с рецептами и фото. Перед импортом показываются
              совпадения и итоговый план.
            </p>
            {settings.keyboardShortcuts && (
              <>
                <h3>Клавиатура</h3>
                <dl className="shortcut-list">
                  <div>
                    <dt>Ctrl/⌘ + S</dt>
                    <dd>сохранить сейчас</dd>
                  </div>
                  <div>
                    <dt>Alt + Shift + I</dt>
                    <dd>добавить ингредиент</dd>
                  </div>
                  <div>
                    <dt>Alt + Shift + S</dt>
                    <dd>добавить шаг</dd>
                  </div>
                  <div>
                    <dt>?</dt>
                    <dd>открыть эту справку</dd>
                  </div>
                  <div>
                    <dt>Esc</dt>
                    <dd>закрыть окно</dd>
                  </div>
                </dl>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
