import { Hono } from 'hono';
import { z } from 'zod';

import {
  pageQuerySchema,
  proxyCreateSchema,
  proxyImportSchema,
} from '../../../lib/api/schemas.ts';
import {
  parseBody,
  parseQuery,
  pathId,
  queryBoolean,
} from '../../lib/http-input.ts';
import type { Manager } from '../sessions/manager.ts';

const deleteQuerySchema = z.object({ force: queryBoolean.default(false) });

/** `/api/proxies`: the pool. The API never returns a password. */
export function createProxyRoutes(manager: Manager): Hono {
  const routes = new Hono();

  routes.get('/', (c) => {
    const page = parseQuery(c, pageQuerySchema);
    c.header('X-Total-Count', String(manager.countProxies()));
    return c.json(manager.listProxies(page));
  });

  routes.post('/', async (c) => {
    const { proxy, defaultScheme } = await parseBody(c, proxyCreateSchema);
    return c.json(manager.addProxy(proxy, { defaultScheme }), 201);
  });

  routes.post('/import', async (c) => {
    const { text, defaultScheme } = await parseBody(c, proxyImportSchema);
    return c.json(manager.importProxies(text, { defaultScheme }));
  });

  routes.post('/check-all', (c) => c.json(manager.checkAllProxies(), 202));

  routes.delete('/:id', (c) => {
    const id = pathId(c, 'proxy');
    const { force } = parseQuery(c, deleteQuerySchema);
    manager.deleteProxy(id, { force });
    return c.body(null, 204);
  });

  routes.post('/:id/check', (c) =>
    c.json(manager.checkProxy(pathId(c, 'proxy')), 202),
  );

  return routes;
}
