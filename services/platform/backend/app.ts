import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from './auth/auth.ts';
import { requireSession, type AuthEnv } from './auth/session.ts';
import { createAuditLogRoutes } from './domains/audit_logs/routes.ts';
import { createChatRoutes } from './domains/chat/routes.ts';
import { createContactRoutes } from './domains/contacts/routes.ts';
import { createDocumentRoutes } from './domains/documents/routes.ts';
import { createFeedbackRoutes } from './domains/feedback/routes.ts';
import { createFileRoutes } from './domains/files/routes.ts';
import { createFolderRoutes } from './domains/folders/routes.ts';
import { createKnowledgeRoutes } from './domains/knowledge/routes.ts';
import { createMemberRoutes } from './domains/members/routes.ts';
import { createNotificationRoutes } from './domains/notifications/routes.ts';
import { createOrganizationRoutes } from './domains/organizations/routes.ts';
import { createProductRoutes } from './domains/products/routes.ts';
import { createProjectRoutes } from './domains/projects/routes.ts';
import { createProviderCredentialRoutes } from './domains/provider_credentials/routes.ts';
import { createSupportCaseRoutes } from './domains/support_cases/routes.ts';
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
  app.route('/api/app/chat', createChatRoutes(deps));
  app.route('/api/app/contacts', createContactRoutes(deps));
  app.route('/api/app/documents', createDocumentRoutes(deps));
  app.route('/api/app/files', createFileRoutes(deps));
  app.route('/api/app/folders', createFolderRoutes(deps));
  app.route('/api/app/feedback', createFeedbackRoutes(deps));
  app.route('/api/app/knowledge', createKnowledgeRoutes(deps));
  app.route('/api/app/members', createMemberRoutes(deps));
  app.route('/api/app/notifications', createNotificationRoutes(deps));
  app.route('/api/app/organizations', createOrganizationRoutes(deps));
  app.route('/api/app/products', createProductRoutes(deps));
  app.route('/api/app/projects', createProjectRoutes(deps));
  app.route(
    '/api/app/provider-credentials',
    createProviderCredentialRoutes(deps),
  );
  app.route('/api/app/support-cases', createSupportCaseRoutes(deps));
  app.route('/api/app/tasks', createTaskRoutes(deps));
  app.route('/api/app/user-preferences', createUserPreferenceRoutes(deps));
  app.route('/api/app/users', createUserRoutes(deps));
  return app;
}
