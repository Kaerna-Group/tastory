import { env } from '@/shared/config';
import { createApiClient, createHttpTransport } from './client';
import type { ApiTransport } from './client';

const transport: ApiTransport = async (request, signal) => {
  if (env.apiMode === 'mock') {
    const { mockTransport } = await import('./mock-transport');
    return mockTransport(request, signal);
  }
  return createHttpTransport(env.apiUrl)(request, signal);
};
export const apiClient = createApiClient(transport);
