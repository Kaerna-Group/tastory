import type { RecipeModelContext } from './recipe-model';
import type { RecipeStore } from './recipe-storage';

export type RecipeWriteContext = Omit<RecipeModelContext, 'reader'> & {
  store: RecipeStore;
  sha256: (text: string) => string;
};
