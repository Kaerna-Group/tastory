import { API_VERSION, SCHEMA_VERSION } from '@tastory/contracts';
import type { ApiTransport } from './client';

export const mockTransport: ApiTransport = (request, signal) => {
  signal?.throwIfAborted();
  return Promise.resolve({
    ok: true,
    requestId: request.requestId,
    data:
      request.action === 'health'
        ? {
            status: 'ok',
            service: 'tastory-api',
            deploymentVersion: 'local-mock',
            timestamp: new Date().toISOString(),
            storage: 'not-configured',
            auth: 'not-configured',
          }
        : request.payload,
    meta: { apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION },
  });
};
