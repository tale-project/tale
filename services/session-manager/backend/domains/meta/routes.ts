import { Hono } from 'hono';

import type { Manager } from '../sessions/manager.ts';

/** `/api/meta`: what the pages need to know about the app and its counts. */
export function createMetaRoutes(manager: Manager): Hono {
  const routes = new Hono();

  routes.get('/', (c) => c.json(manager.meta()));

  return routes;
}
