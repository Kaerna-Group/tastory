export type RuntimeEnvironment = 'staging' | 'production';

export function runtimeEnvironment(value: string | null): RuntimeEnvironment | null {
  return value === 'staging' || value === 'production' ? value : null;
}
