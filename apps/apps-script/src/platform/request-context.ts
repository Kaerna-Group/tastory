import type { RequestContext } from '../controllers/handle-request';

export function createRequestContext(): RequestContext {
  const properties = PropertiesService.getScriptProperties();
  return {
    now: () => new Date(),
    createRequestId: () => Utilities.getUuid(),
    isEchoEnabled: properties.getProperty('ENABLE_SPIKE_ECHO') === 'true',
    deploymentVersion: properties.getProperty('DEPLOYMENT_VERSION') || 'foundation',
  };
}
