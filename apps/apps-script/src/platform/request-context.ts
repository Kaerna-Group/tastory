import type { RequestContext } from '../controllers/handle-request';
import { authenticateGoogle } from './google-auth';
import { privatePhoto } from './private-photo';
import { concurrencyProbe } from './concurrency-probe';
import { SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { readAdminDirectory } from './admin-directory';

export function createRequestContext(): RequestContext {
  const properties = PropertiesService.getScriptProperties();
  return {
    now: () => new Date(),
    createRequestId: () => Utilities.getUuid(),
    isEchoEnabled: properties.getProperty('ENABLE_SPIKE_ECHO') === 'true',
    deploymentVersion: properties.getProperty('DEPLOYMENT_VERSION') || 'foundation',
    isAuthConfigured:
      properties.getProperty('APP_ENV') === 'staging' &&
      Boolean(
        properties.getProperty('GOOGLE_CLIENT_IDS') &&
        (properties.getProperty(SHEETS_AUTH_CONFIG_KEY) !== null ||
          properties.getProperty('STAGING_INVITES')),
      ),
    authenticate: authenticateGoogle,
    photo: privatePhoto,
    concurrency: concurrencyProbe,
    admin: readAdminDirectory,
  };
}
