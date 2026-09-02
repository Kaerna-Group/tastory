import { createStagingSetupPlatform } from '../platform/staging-resources';
import { setupStagingResources } from '../services/setup-staging';
import type { StagingSetupResult } from '../services/setup-staging';

/** Запускается владельцем из редактора Apps Script; публичного API action нет. */
export function setupStaging(): StagingSetupResult {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10_000)) throw new Error('Настройка уже выполняется. Повторите позже.');
  try {
    const result = setupStagingResources(createStagingSetupPlatform());
    console.info(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
