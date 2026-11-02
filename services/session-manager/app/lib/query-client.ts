import { QueryClient } from '@tanstack/react-query';

/**
 * One client for the app. Reads retry through their own polling instead of
 * react-query's back-off: the page shows "connection lost" and tries again.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true },
  },
});
