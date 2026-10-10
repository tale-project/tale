import { Hono } from 'hono';

import { buildTaleSkill } from '../../../lib/mcp/skill.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';

/**
 * /api/app/mcp — what the app shows about connecting a coding agent to the
 * MCP endpoint.
 *
 * `GET /skill` downloads the Tale skill (`SKILL.md`) for a person to put in
 * their agent's skills folder. It is the same file for every deployment and
 * organization — it names no address, key or organization — so the door asks
 * for a session and nothing else; it is not served without one, so the
 * deployment adds no public surface.
 */
export function createMcpRoutes(deps: { auth: Auth }): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  app.get('/skill', (c) => {
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="SKILL.md"');
    c.header('Cache-Control', 'no-store');
    return c.body(buildTaleSkill());
  });

  return app;
}
