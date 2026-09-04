import type { RequestContext } from '../controllers/handle-request';
import { authenticateGoogle } from './google-auth';
import { privatePhoto } from './private-photo';
import { concurrencyProbe } from './concurrency-probe';
import { SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { readAdminDirectory } from './admin-directory';
import { operationJournal } from './operation-journal';
import { manageAccess } from './access-admin';
import { recipes } from './recipes';
import { backups } from './backups';
import { runtimeEnvironment } from './runtime-environment';
import { admitProductionRequest } from './request-limits';
import { userSettings } from './user-settings';

export function createRequestContext(): RequestContext {
  const properties = PropertiesService.getScriptProperties();
  const environment = runtimeEnvironment(properties.getProperty('APP_ENV'));
  const audienceKey =
    environment === 'production' ? 'PRODUCTION_GOOGLE_CLIENT_IDS' : 'GOOGLE_CLIENT_IDS';
  const authConfigured = Boolean(
    environment &&
    properties.getProperty(audienceKey) &&
    properties.getProperty(SHEETS_AUTH_CONFIG_KEY) !== null,
  );
  return {
    now: () => new Date(),
    createRequestId: () => Utilities.getUuid(),
    isEchoEnabled: properties.getProperty('ENABLE_SPIKE_ECHO') === 'true',
    deploymentVersion: properties.getProperty('DEPLOYMENT_VERSION') || 'foundation',
    ...(authConfigured && environment ? { authEnvironment: environment } : {}),
    admitRequest: admitProductionRequest,
    authenticate: authenticateGoogle,
    photo: privatePhoto,
    concurrency: concurrencyProbe,
    admin: readAdminDirectory,
    journal: operationJournal,
    access: manageAccess,
    recipes,
    backups,
    settings: userSettings,
  };
}
