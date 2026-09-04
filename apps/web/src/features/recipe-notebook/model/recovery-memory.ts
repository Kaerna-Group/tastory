import type { RecipeLocalDraft } from '@tastory/contracts';
import { setReloadBlocked } from '@/shared/update-safety';

// Survives route changes/sign-out, but never crosses the account-scoped key.
// This fallback is not reported as a durable local save.
const copies = new Map<string, RecipeLocalDraft>();
const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};
export function rememberUnsaved(key: string, draft: RecipeLocalDraft) {
  copies.set(key, draft);
  setReloadBlocked('Несохранённая аварийная копия рецепта', true);
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', warnBeforeUnload);
}
export function forgetUnsaved(key: string) {
  copies.delete(key);
  if (copies.size === 0) {
    setReloadBlocked('Несохранённая аварийная копия рецепта', false);
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', warnBeforeUnload);
  }
}
export const readUnsaved = (key: string) => copies.get(key);
export const listUnsaved = () => [...copies.values()];
