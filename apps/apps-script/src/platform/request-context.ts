import type { RequestContext } from '../controllers/handle-request';
import { authenticateGoogle } from './google-auth';
import { privatePhoto } from './private-photo';
import { concurrencyProbe } from './concurrency-probe';

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
        properties.getProperty('GOOGLE_CLIENT_IDS') && properties.getProperty('STAGING_INVITES'),
      ),
    authenticate: authenticateGoogle,
    photo: privatePhoto,
    concurrency: concurrencyProbe,
  };
}
