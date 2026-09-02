import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api';
export function useConnectionStatus() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: async ({ signal }) => {
      const health = await apiClient.health(signal);
      return { isReachable: health.status === 'ok', checkedAt: health.timestamp };
    },
    staleTime: 30_000,
    retry: false,
  });
}
