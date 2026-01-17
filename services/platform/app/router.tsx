import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { ConvexQueryClient } from '@convex-dev/react-query';
import { ConvexReactClient } from 'convex/react';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
  convex: ConvexReactClient;
}

export function createRouter() {
  const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
  const convexQueryClient = new ConvexQueryClient(convex);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        staleTime: 5 * 60 * 1000,
      },
    },
  });

  convexQueryClient.connect(queryClient);

  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
      convexQueryClient,
      convex,
    },
    defaultPreload: 'intent',
    scrollRestoration: true,
    ...(history && { history }),
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
