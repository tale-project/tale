import { Hono } from 'hono';

import {
  pageQuerySchema,
  sessionCreateSchema,
  sessionUpdateSchema,
  startRequestSchema,
} from '../../../lib/api/schemas.ts';
import {
  parseBody,
  parseOptionalBody,
  parseQuery,
  pathId,
} from '../../lib/http-input.ts';
import type { Manager } from './manager.ts';

/**
 * `/api/sessions`: the browsers. Starting, stopping, restarting and rotating
 * answer 202 with the session as it is then: the work goes on in the
 * background, and the session's status tells how far it is.
 */
export function createSessionRoutes(manager: Manager): Hono {
  const routes = new Hono();

  routes.get('/', (c) => {
    const page = parseQuery(c, pageQuerySchema);
    c.header('X-Total-Count', String(manager.countSessions()));
    return c.json(manager.listSessions(page));
  });

  // The proxy file of the sessions, with passwords, as a download. Before
  // `/:id`, which would take "export-proxies" for an id.
  routes.get('/export-proxies', (c) => {
    // A proxy without a username or password has no such key (never `null`).
    const file = JSON.stringify(manager.exportProxies(), null, 2);
    return c.newResponse(file, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="proxy.json"',
        'Cache-Control': 'no-store',
      },
    });
  });

  routes.get('/:id', (c) => c.json(manager.session(pathId(c, 'session'))));

  routes.post('/', async (c) => {
    const { name, os } = await parseBody(c, sessionCreateSchema);
    return c.json(await manager.createSession({ name, os }), 201);
  });

  routes.patch('/:id', async (c) => {
    const id = pathId(c, 'session');
    const { name } = await parseBody(c, sessionUpdateSchema);
    return c.json(manager.renameSession(id, name));
  });

  routes.post('/:id/start', async (c) => {
    const id = pathId(c, 'session');
    const { force } = await parseOptionalBody(c, startRequestSchema);
    return c.json(await manager.startSession(id, { force }), 202);
  });

  routes.post('/:id/stop', async (c) =>
    c.json(await manager.stopSession(pathId(c, 'session')), 202),
  );

  // Closes the browser and opens it again with the same proxy and tabs: its
  // timezone and location are derived again from the proxy's exit IP as it is now.
  routes.post('/:id/restart', async (c) =>
    c.json(await manager.restartSession(pathId(c, 'session')), 202),
  );

  // Looks at the exit IP of the session's proxy now (see `location.inSync`).
  routes.post('/:id/check-ip', async (c) =>
    c.json(await manager.checkSessionIp(pathId(c, 'session'))),
  );

  routes.post('/:id/rotate', async (c) =>
    c.json(await manager.rotateSession(pathId(c, 'session')), 202),
  );

  routes.delete('/:id', async (c) => {
    await manager.deleteSession(pathId(c, 'session'));
    return c.body(null, 204);
  });

  return routes;
}
