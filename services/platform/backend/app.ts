import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from './auth/auth.ts';
import { requireSession, type AuthEnv } from './auth/session.ts';
import { createAgentSecretRoutes } from './domains/agent_secrets/routes.ts';
import { createAgentRoutes } from './domains/agents/routes.ts';
import { createApprovalRoutes } from './domains/approvals/routes.ts';
import { createAuditLogRoutes } from './domains/audit_logs/routes.ts';
import { createAutomationRoutes } from './domains/automations/routes.ts';
import { createWebhookRoutes } from './domains/automations/triggers.ts';
import { createBrandingRoutes } from './domains/branding/routes.ts';
import { createChangelogRoutes } from './domains/changelog/routes.ts';
import { createChatRoutes } from './domains/chat/routes.ts';
import {
  createCloudImportOauthRoutes,
  createCloudImportRoutes,
} from './domains/cloud_import/routes.ts';
import { createCollabRoutes } from './domains/collab/routes.ts';
import { createConnectorCredentialRoutes } from './domains/connector_credentials/routes.ts';
import { createContactRoutes } from './domains/contacts/routes.ts';
import { createControlRoutes } from './domains/control/routes.ts';
import { createConversationRoutes } from './domains/conversations/routes.ts';
import { createDocumentRoutes } from './domains/documents/routes.ts';
import { createErasureRoutes } from './domains/erasure/routes.ts';
import { createFeedbackRoutes } from './domains/feedback/routes.ts';
import { createFileRoutes } from './domains/files/routes.ts';
import { createFolderRoutes } from './domains/folders/routes.ts';
import { createGoogleDriveRoutes } from './domains/google_drive/routes.ts';
import { createKnowledgeRoutes } from './domains/knowledge/routes.ts';
import { createKnowledgeEntryRoutes } from './domains/knowledge_entries/routes.ts';
import { createLegalHoldRoutes } from './domains/legal_holds/routes.ts';
import { createMemberRoutes } from './domains/members/routes.ts';
import { createNotificationRoutes } from './domains/notifications/routes.ts';
import { createOneDriveRoutes } from './domains/onedrive/routes.ts';
import { createOrganizationRoutes } from './domains/organizations/routes.ts';
import { createProductRoutes } from './domains/products/routes.ts';
import { createProjectRoutes } from './domains/projects/routes.ts';
import { createProviderCredentialRoutes } from './domains/provider_credentials/routes.ts';
import { createRetentionRoutes } from './domains/retention/routes.ts';
import { createToolDispatchRoutes } from './domains/sandbox/dispatch-routes.ts';
import { createSandboxRoutes } from './domains/sandbox/routes.ts';
import {
  createScimAdminRoutes,
  createScimRoutes,
} from './domains/scim/routes.ts';
import { createSkillRoutes } from './domains/skills/routes.ts';
import { createSsoAdminRoutes } from './domains/sso/admin-routes.ts';
import { createSsoRoutes } from './domains/sso/routes.ts';
import { createTrustedHeadersRoutes } from './domains/sso/trusted-headers.ts';
import { createSupportCaseRoutes } from './domains/support_cases/routes.ts';
import { createTaskRoutes } from './domains/tasks/routes.ts';
import { createTeamRoutes } from './domains/teams/routes.ts';
import { createTtsRoutes } from './domains/tts/routes.ts';
import { createUserPreferenceRoutes } from './domains/user_preferences/routes.ts';
import { createUserRoutes } from './domains/users/routes.ts';
import { createVideoLinkRoutes } from './domains/video_links/routes.ts';
import {
  createWebdavAdminRoutes,
  createWebdavProtocolRoutes,
} from './domains/webdav/routes.ts';
import { createWebsiteRoutes } from './domains/websites/routes.ts';
import { createEventsHandler } from './realtime/sse.ts';
import { createRestV1Routes } from './rest/v1.ts';

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
  // In-sandbox workspace-tool dispatch (session-token bearer auth, not a
  // browser session) — the container-facing machine door.
  app.route('/api/tools', createToolDispatchRoutes({ sql: deps.sql }));
  // Automation webhook triggers — the token in the path is the credential.
  app.route('/api/automations/webhook', createWebhookRoutes({ sql: deps.sql }));

  // Enterprise SSO — pre-auth by nature (it CREATES the session). Mounted on
  // the 0.5-native path and on the 0.4 proxy-era alias: IdP registrations
  // (redirect URIs, SP entity ids, ACS URLs) carry `/http_api/api/sso/...`,
  // and re-registering every IdP at cutover is not an option.
  const ssoRoutes = createSsoRoutes({ sql: deps.sql });
  app.route('/api/sso', ssoRoutes);
  app.route('/api/app/sso', createSsoAdminRoutes(deps));
  app.route('/http_api/api/sso', ssoRoutes);

  // SCIM 2.0 provisioning — bearer-token auth (the matched token row IS the
  // tenant); same 0.4 proxy-era alias story as SSO.
  const scimRoutes = createScimRoutes({ sql: deps.sql });
  app.route('/scim/v2', scimRoutes);
  app.route('/http_api/scim/v2', scimRoutes);

  // Trusted-headers hand-off (reverse-proxy auth) — same alias story.
  const trustedRoutes = createTrustedHeadersRoutes({ sql: deps.sql });
  app.route('/api/trusted-headers', trustedRoutes);
  app.route('/http_api/api/trusted-headers', trustedRoutes);
  // The REST machine door (Bearer API key).
  app.route('/api/v1', createRestV1Routes(deps));
  // Internal app API (the surface the web app consumes); one sub-app per
  // ported domain.
  app.route('/api/app/agent-secrets', createAgentSecretRoutes(deps));
  app.route('/api/app/agents', createAgentRoutes(deps));
  app.route('/api/app/audit-logs', createAuditLogRoutes(deps));
  app.route('/api/app/branding', createBrandingRoutes(deps));
  app.route('/api/app/automations', createAutomationRoutes(deps));
  app.route('/api/app/chat', createChatRoutes(deps));
  app.route('/api/app/changelog', createChangelogRoutes(deps));
  app.route('/api/app/collab', createCollabRoutes(deps));
  app.route(
    '/api/app/connector-credentials',
    createConnectorCredentialRoutes(deps),
  );
  app.route('/api/app/contacts', createContactRoutes(deps));
  app.route('/api/app/approvals', createApprovalRoutes(deps));
  app.route('/api/control', createControlRoutes(deps));
  app.route('/api/app/tts', createTtsRoutes(deps));
  // Cloud-import OAuth: the wire path is registered with the vendors, so
  // it keeps the 0.4 identity (+ the proxy-era alias, like SSO).
  const cloudImportOauth = createCloudImportOauthRoutes(deps);
  app.route('/api/cloud-import/oauth2', cloudImportOauth);
  app.route('/http_api/api/cloud-import/oauth2', cloudImportOauth);
  app.route('/api/app/cloud-import', createCloudImportRoutes(deps));
  // WebDAV (/dav/<orgSlug>/…): HTTP Basic app-password auth lives inside the
  // reused dispatch; the raw request URL carries the /dav prefix the parser
  // expects, so the mount path only scopes routing.
  app.route('/dav', createWebdavProtocolRoutes(deps));
  app.route('/api/app/webdav', createWebdavAdminRoutes(deps));
  app.route('/api/app/conversations', createConversationRoutes(deps));
  app.route('/api/app/documents', createDocumentRoutes(deps));
  app.route('/api/app/files', createFileRoutes(deps));
  app.route('/api/app/folders', createFolderRoutes(deps));
  app.route('/api/app/erasure', createErasureRoutes(deps));
  app.route('/api/app/feedback', createFeedbackRoutes(deps));
  app.route('/api/app/knowledge', createKnowledgeRoutes(deps));
  app.route('/api/app/legal-holds', createLegalHoldRoutes(deps));
  app.route('/api/app/scim', createScimAdminRoutes(deps));
  app.route('/api/app/knowledge-entries', createKnowledgeEntryRoutes(deps));
  app.route('/api/app/members', createMemberRoutes(deps));
  app.route('/api/app/google-drive', createGoogleDriveRoutes(deps));
  app.route('/api/app/notifications', createNotificationRoutes(deps));
  app.route('/api/app/onedrive', createOneDriveRoutes(deps));
  app.route('/api/app/organizations', createOrganizationRoutes(deps));
  app.route('/api/app/products', createProductRoutes(deps));
  app.route('/api/app/projects', createProjectRoutes(deps));
  app.route('/api/app/retention', createRetentionRoutes(deps));
  app.route(
    '/api/app/provider-credentials',
    createProviderCredentialRoutes(deps),
  );
  app.route('/api/app/sandbox', createSandboxRoutes(deps));
  app.route('/api/app/skills', createSkillRoutes(deps));
  app.route('/api/app/support-cases', createSupportCaseRoutes(deps));
  app.route('/api/app/tasks', createTaskRoutes(deps));
  app.route('/api/app/teams', createTeamRoutes(deps));
  app.route('/api/app/video-links', createVideoLinkRoutes(deps));
  app.route('/api/app/user-preferences', createUserPreferenceRoutes(deps));
  app.route('/api/app/users', createUserRoutes(deps));
  app.route('/api/app/websites', createWebsiteRoutes(deps));
  return app;
}
