import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getUserSettings, subscribeUserSettings } from '@/entities/user-settings';

const editing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.matches('input, textarea, select') || target.isContentEditable);

export function HelpCenter(): React.JSX.Element {
  const { settings } = useSyncExternalStore(subscribeUserSettings, getUserSettings);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (settings.keyboardShortcuts && event.key === '?' && !editing(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [settings.keyboardShortcuts]);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    closeRef.current?.focus();
    const controlFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', controlFocus);
    return () => {
      document.removeEventListener('keydown', controlFocus);
      trigger?.focus();
    };
  }, [open]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="help-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Справка <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
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
              Экспорт создаёт файл Tastory с рецептами, фото и оформлением. Перед импортом
              показываются совпадения и итоговый план.
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
