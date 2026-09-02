import { useState } from 'react';
import { applyTheme, readTheme } from '@/shared/theme';
export function ThemeSwitch(): React.JSX.Element {
  const [theme, setTheme] = useState(readTheme);
  return (
    <button
      className="button button-secondary"
      type="button"
      aria-pressed={theme === 'dark'}
      onClick={() => {
        const next = theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
        setTheme(next);
      }}
    >
      Темная тема
    </button>
  );
}
