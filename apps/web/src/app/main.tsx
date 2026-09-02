import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyTheme, readTheme } from '@/shared/theme';
import { App } from './app';
import './styles.css';
const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент приложения.');
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});
applyTheme(readTheme());
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
