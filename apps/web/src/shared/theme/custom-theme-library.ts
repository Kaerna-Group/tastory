import { parseThemeProfile } from './theme';
import type { ThemeProfile } from './theme';

export type CustomTheme = Readonly<{
  id: string;
  profile: ThemeProfile;
  createdAt: string;
  updatedAt: string;
}>;

const STORAGE_KEY = 'tastory.custom-theme-library.v1';
const MAX_CUSTOM_THEMES = 40;
const idPattern = /^[a-z0-9-]{8,80}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

export function parseCustomThemeLibrary(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const themes: CustomTheme[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isObject(item)) continue;
    const id = item['id'];
    const profile = parseThemeProfile(item['profile']);
    const createdAt = item['createdAt'];
    const updatedAt = item['updatedAt'];
    if (
      typeof id !== 'string' ||
      !idPattern.test(id) ||
      ids.has(id) ||
      !profile ||
      !validDate(createdAt) ||
      !validDate(updatedAt)
    )
      continue;
    ids.add(id);
    themes.push({ id, profile, createdAt, updatedAt });
    if (themes.length === MAX_CUSTOM_THEMES) break;
  }
  return themes.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export function readCustomThemeLibrary(): CustomTheme[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseCustomThemeLibrary(JSON.parse(saved)) : [];
  } catch {
    return [];
  }
}

function writeCustomThemeLibrary(themes: ReadonlyArray<CustomTheme>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes.slice(0, MAX_CUSTOM_THEMES)));
    return true;
  } catch {
    return false;
  }
}

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export function saveCustomTheme(profileValue: ThemeProfile, id?: string): CustomTheme | null {
  const profile = parseThemeProfile(profileValue);
  if (!profile) return null;
  const current = readCustomThemeLibrary();
  const existing = id ? current.find((theme) => theme.id === id) : undefined;
  const now = new Date().toISOString();
  const saved: CustomTheme = {
    id: existing?.id ?? createId(),
    profile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = [saved, ...current.filter((theme) => theme.id !== saved.id)].slice(
    0,
    MAX_CUSTOM_THEMES,
  );
  return writeCustomThemeLibrary(next) ? saved : null;
}

export function removeCustomTheme(id: string): boolean {
  if (!idPattern.test(id)) return false;
  return writeCustomThemeLibrary(readCustomThemeLibrary().filter((theme) => theme.id !== id));
}
