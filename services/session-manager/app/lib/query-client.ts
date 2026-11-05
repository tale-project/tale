import { QueryClient } from '@tanstack/react-query';

/**
 * One client for the app. Reads retry through their own polling instead of
 * react-query's back-off: the page shows "connection lost" and tries again.
 *
 * An answer a second old is current: the read a route's loader made a moment
 * before its page mounted is not asked for again by the page (react-query asks
 * again on mount for anything stale, and with no `staleTime` everything is).
 * The polls and the writes keep it current from there. A window that comes
 * back, and a connection that does, ask again whatever the age of the answer:
 * a change made elsewhere meanwhile (an AI assistant's) shows at once.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 1_000,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
    },
  },
});
