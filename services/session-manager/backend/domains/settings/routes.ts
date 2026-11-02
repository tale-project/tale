import { Hono } from 'hono';

import { settingsUpdateSchema } from '../../../lib/api/schemas.ts';
import { parseBody } from '../../lib/http-input.ts';
import type { Manager } from '../sessions/manager.ts';

/** `/api/settings`: the start page and AI access. */
export function createSettingsRoutes(manager: Manager): Hono {
  const routes = new Hono();

  routes.get('/', (c) => c.json(manager.settings()));

  routes.patch('/', async (c) => {
    const update = await parseBody(c, settingsUpdateSchema);
    return c.json(manager.updateSettings(update));
  });

  return routes;
}
