import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from './auth/auth.ts';
import { requireSession, type AuthEnv } from './auth/session.ts';
import { createAuditLogRoutes } from './domains/audit_logs/routes.ts';
import { createMemberRoutes } from './domains/members/routes.ts';
import { createNotificationRoutes } from './domains/notifications/routes.ts';
import { createOrganizationRoutes } from './domains/organizations/routes.ts';
import { createProjectRoutes } from './domains/projects/routes.ts';
import { createTaskRoutes } from './domains/tasks/routes.ts';
import { createUserPreferenceRoutes } from './domains/user_preferences/routes.ts';
import { createUserRoutes } from './domains/users/routes.ts';
import { createEventsHandler } from './realtime/sse.ts';

export interface AppDeps {
  sql: Sql;
  auth: Auth;
}

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.get('/ping', (c) => c.json({ ok: true, service: 'backend' }));
  // Better Auth owns everything under its basePath (sign-up/in/out, session,
  // organization plugin endpoints, api-key/two-factor/passkey, …).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));
  app.get('/events', requireSession(deps.auth), createEventsHandler(deps.sql));
  // Internal app API (the surface the web app consumes); one sub-app per
  // ported domain.
  app.route('/api/app/audit-logs', createAuditLogRoutes(deps));
  app.route('/api/app/members', createMemberRoutes(deps));
  app.route('/api/app/notifications', createNotificationRoutes(deps));
  app.route('/api/app/organizations', createOrganizationRoutes(deps));
  app.route('/api/app/projects', createProjectRoutes(deps));
  app.route('/api/app/tasks', createTaskRoutes(deps));
  app.route('/api/app/user-preferences', createUserPreferenceRoutes(deps));
  app.route('/api/app/users', createUserRoutes(deps));
  return app;
}
