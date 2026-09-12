import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Sql } from 'postgres';

import { API_KEY_HEADER, loadTrustedProxies, type Auth } from './auth/auth.ts';
import { createIdentityRoutes } from './auth/identity-routes.ts';
import { withOAuthConformance } from './auth/oauth-conformance.ts';
import { requireSession, type AuthEnv } from './auth/session.ts';
import { createAgentSecretRoutes } from './domains/agent_secrets/routes.ts';
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
import { createConnectorBridgeRoutes } from './domains/connectors/bridge-routes.ts';
import { createConnectorOauthAppRoutes } from './domains/connectors/oauth-app-routes.ts';
import { createConnectorOauthRoutes } from './domains/connectors/oauth-routes.ts';
import { createSlackEventRoutes } from './domains/connectors/slack-events.ts';
import { createContactRoutes } from './domains/contacts/routes.ts';
import { createControlRoutes } from './domains/control/routes.ts';
import { isBackendDraining, replicaColour } from './domains/control/service.ts';
import { createConversationRoutes } from './domains/conversations/routes.ts';
import { createDeploymentRoutes } from './domains/deployment/routes.ts';
import { createDocumentRoutes } from './domains/documents/routes.ts';
import { createErasureRoutes } from './domains/erasure/routes.ts';
import { createFeedbackRoutes } from './domains/feedback/routes.ts';
import { createFileRoutes } from './domains/files/routes.ts';
import { createSandboxBlobRoutes } from './domains/files/sandbox-blob-routes.ts';
import { createFolderRoutes } from './domains/folders/routes.ts';
import { createGoogleDriveRoutes } from './domains/google_drive/routes.ts';
import { createGovernanceRoutes } from './domains/governance/routes.ts';
import { createKnowledgeRoutes } from './domains/knowledge/routes.ts';
import { createKnowledgeEntryRoutes } from './domains/knowledge_entries/routes.ts';
import { createLegalHoldRoutes } from './domains/legal_holds/routes.ts';
import { createMemberRoutes } from './domains/members/routes.ts';
import { createNotificationRoutes } from './domains/notifications/routes.ts';
import { createObjectStorageRoutes } from './domains/object_storage/routes.ts';
import { createOneDriveRoutes } from './domains/onedrive/routes.ts';
import { createOrganizationRoutes } from './domains/organizations/routes.ts';
import { createProductRoutes } from './domains/products/routes.ts';
import { createProjectRoutes } from './domains/projects/routes.ts';
import { createProviderCredentialRoutes } from './domains/provider_credentials/routes.ts';
import { createProviderSettingRoutes } from './domains/providers/routes.ts';
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
import { createTaskRoutes } from './domains/tasks/routes.ts';
import { createTeamRoutes } from './domains/teams/routes.ts';
import { createTtsRoutes } from './domains/tts/routes.ts';
import { createTwoFactorRoutes } from './domains/two_factor/routes.ts';
import { createUserPreferenceRoutes } from './domains/user_preferences/routes.ts';
import { createUserRoutes } from './domains/users/routes.ts';
import { createVideoLinkRoutes } from './domains/video_links/routes.ts';
import {
  createWebdavAdminRoutes,
  createWebdavProtocolRoutes,
} from './domains/webdav/routes.ts';
import { createWebsiteRoutes } from './domains/websites/routes.ts';
import { appErrorHandler } from './error-reporting.ts';
import { conditionalGet } from './lib/conditional-get.ts';
import {
  apiKeyHeaderGuard,
  apiNotFound,
  apiPathWithoutTrailingSlash,
  backendSecureHeaders,
  nulUrlGuard,
  uriLengthGuard,
} from './lib/http-hygiene.ts';
import { createSseAuthRoutes } from './realtime/oracle-routes.ts';
import { createEventsHandler } from './realtime/sse.ts';
import { mountRestV1Routes } from './rest/v1.ts';
import {
  backendMetricsResponse,
  httpDuration,
  httpRequests,
  initBackendTelemetry,
  routeClass,
} from './telemetry.ts';

export interface AppDeps {
  sql: Sql;
  auth: Auth;
}

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  // One trailing slash under /api/v1/ routes like its absence
  // (lib/http-hygiene.ts) — the path is normalised once, here, so every
  // door and the 405/OPTIONS probe read the same value.
  const app = new Hono<AuthEnv>({ getPath: apiPathWithoutTrailingSlash });
  // Idempotent (guarded by the module's own flag): `main.ts` already
  // initializes at boot for every role, and this covers hosts that build the
  // app directly — an app with a `/metrics` route that renders an empty
  // registry is worse than no route at all.
  initBackendTelemetry(deps.sql);
  // Hono's default 500 behavior plus Sentry capture (no-op without a DSN);
  // sub-app errors bubble up here unless a sub-app registers its own.
  app.onError(appErrorHandler);
  // The JSON 404 for the API prefix (lib/http-hygiene.ts).
  app.notFound(apiNotFound);
  // One id per request, echoed as `X-Request-Id` on every response and
  // carried into error reports — the handle a caller quotes in a ticket.
  // An inbound id (a client's or the proxy's) is kept when it is a sane
  // token; anything else is replaced. The middleware stamps the header
  // BEFORE the handler runs, onto headers Hono merges only into responses
  // it builds itself (`c.json`, `c.body`) — a handler that returns a raw
  // `Response` (the MCP endpoint, an attachment's bytes) dropped it, so
  // the id is set again on whatever response came back.
  const stampRequestId = requestId();
  app.use(async (c, next) => {
    await stampRequestId(c, next);
    const id = c.get('requestId');
    if (typeof id === 'string' && !c.res.headers.has('x-request-id')) {
      c.res.headers.set('x-request-id', id);
    }
  });
  // The transport-security headers every response carries — registered
  // ahead of the guards below so a pre-route refusal (a 401, a 414, a NUL
  // 400) wears them too (lib/http-hygiene.ts).
  app.use(backendSecureHeaders(process.env.SITE_URL));
  // The api-key plugin's header is the REST door's internal hand-off, never
  // a client credential: carried by a client it would open every session
  // gate below with the key holder's identity (lib/http-hygiene.ts).
  app.use(apiKeyHeaderGuard([API_KEY_HEADER]));
  // The URL budget the contract documents (414), then the NUL-byte refusal
  // (400) — both before any door decodes the path into a lookup.
  app.use(uriLengthGuard());
  app.use(nulUrlGuard());
  // LIVENESS: the process is up. Docker's HEALTHCHECK reads this, so it must
  // stay 200 while a replica drains — a draining container is doing exactly
  // what it was asked to; killing it mid-drain cuts the generations the drain
  // is waiting for.
  app.get('/ping', (c) => c.json({ ok: true, service: 'backend' }));
  // READINESS: this replica accepts NEW work. 503 once the deploy has aimed
  // a drain at it, which is what lets `tale deploy` watch a colour stop
  // taking turns before it cuts that colour out of DNS. Deliberately
  // separate from `/ping` and deliberately not proxied: it is the deploy's
  // question, not the internet's.
  app.get('/ready', async (c) => {
    const draining = await isBackendDraining(deps.sql);
    return c.json(
      {
        ok: !draining,
        service: 'backend',
        colour: replicaColour(),
        ...(draining ? { reason: 'draining' } : {}),
      },
      draining ? 503 : 200,
    );
  });
  // Prometheus scrape. Reachable publicly only through the proxy's
  // token-gated `/metrics/backend` lane; inside the network it is the plain
  // pull endpoint every sidecar expects.
  app.get('/metrics', () => backendMetricsResponse());
  // Request counters/histograms for everything below, labelled by a BOUNDED
  // route class (never the raw path — ids would make the label set
  // unbounded). Declared before the routes so it wraps them all.
  app.use(async (c, next) => {
    const started = performance.now();
    const route = routeClass(c.req.path);
    const method = c.req.method;
    try {
      await next();
    } finally {
      const seconds = (performance.now() - started) / 1000;
      httpDuration.observe({ method, route }, seconds);
      httpRequests.inc({
        method,
        route,
        status: `${Math.floor(c.res.status / 100)}xx`,
      });
    }
  });
  // Validated reads on both JSON surfaces (lib/conditional-get.ts): every
  // 200 JSON GET/HEAD carries an ETag, a matching If-None-Match answers 304
  // without the body, and `private, no-cache` lets the client keep what it
  // must revalidate. The REST door stamps `no-store` on every answer by
  // default; that default — never a route's own directive — is what the
  // validated-read directive replaces there.
  app.use('/api/app/*', conditionalGet());
  app.use('/api/v1/*', conditionalGet({ replaceDoorDefault: 'no-store' }));
  // Better Auth owns everything under its basePath (sign-up/in/out, session,
  // organization plugin endpoints, api-key/two-factor/passkey, …).
  // The OAuth/OIDC answers under /api/auth/oauth2/* in their RFC envelopes
  // (401 + challenge for a bad bearer, `invalid_request` for a schema
  // refusal); every other auth route passes through as the library made it.
  // The realm is the issuer — the auth instance's own base URL, the one
  // discovery and the tokens name.
  const oidcRealm = () =>
    `${(deps.auth.options.baseURL ?? process.env.SITE_URL ?? '').replace(/\/$/, '')}/api/auth`;
  app.on(['GET', 'POST'], '/api/auth/*', async (c) =>
    withOAuthConformance(
      c.req.raw,
      await deps.auth.handler(c.req.raw),
      oidcRealm(),
    ),
  );
  app.route('/api/app/identity', createIdentityRoutes(deps));
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) =>
    oauthProviderAuthServerMetadata(deps.auth)(c.req.raw),
  );
  app.get('/events', requireSession(deps.auth), createEventsHandler(deps.sql));
  // Oracle for the platform web tier's own browser connection — it forwards
  // the request Cookie and acts on the verdict (realtime/oracle-routes.ts).
  app.route('/api/sse', createSseAuthRoutes(deps));
  // In-sandbox workspace-tool dispatch (session-token bearer auth, not a
  // browser session) — the container-facing machine door.
  app.route('/api/tools', createToolDispatchRoutes({ sql: deps.sql }));
  app.route('/api/connectors', createConnectorBridgeRoutes({ sql: deps.sql }));
  // Org-bucket blob staging for sandbox sessions (HMAC stage-token gated,
  // not session auth) — the container-facing twin of the bridge above.
  app.route('/api/sandbox-blob', createSandboxBlobRoutes({ sql: deps.sql }));
  // Connector OAuth2 consent flow — browser-facing: `start` is
  // session-gated, `callback` is authorized by its single-use state row (the
  // vendor redirects the browser back with no cookie guarantee).
  app.route(
    '/api/connectors/oauth2',
    createConnectorOauthRoutes({ sql: deps.sql, auth: deps.auth }),
  );

  // Slack Events API — one deployment-wide Request URL for every connected
  // workspace; authorized by the request signature, never a session.
  app.route('/api/connectors/slack', createSlackEventRoutes({ sql: deps.sql }));

  // Automation webhook triggers — the token in the path is the credential.
  app.route(
    '/api/automations/webhook',
    createWebhookRoutes({ sql: deps.sql, trustedProxies: loadTrustedProxies }),
  );
  app.route(
    '/api/projects/:id/automations/webhook',
    createWebhookRoutes({ sql: deps.sql, trustedProxies: loadTrustedProxies }),
  );

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
  // The REST machine door (Bearer API key), with its JSON 404 catch-all.
  mountRestV1Routes(app, deps);
  // Internal app API (the surface the web app consumes); one sub-app per
  // ported domain.
  app.route('/api/app/agent-secrets', createAgentSecretRoutes(deps));
  app.route('/api/app/audit-logs', createAuditLogRoutes(deps));
  app.route('/api/app/branding', createBrandingRoutes(deps));
  app.route('/api/app/deployment', createDeploymentRoutes(deps));
  app.route('/api/app/object-storage', createObjectStorageRoutes(deps));
  app.route('/api/app/automations', createAutomationRoutes(deps));
  app.route('/api/app/chat', createChatRoutes(deps));
  app.route('/api/app/changelog', createChangelogRoutes(deps));
  app.route('/api/app/collab', createCollabRoutes(deps));
  app.route(
    '/api/app/connector-credentials',
    createConnectorCredentialRoutes(deps),
  );
  // Org-level OAuth app registry (Settings > Connectors, admin-gated writes).
  app.route(
    '/api/app/connector-oauth-apps',
    createConnectorOauthAppRoutes(deps),
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
  app.route('/api/app/governance', createGovernanceRoutes(deps));
  app.route('/api/app/notifications', createNotificationRoutes(deps));
  app.route('/api/app/onedrive', createOneDriveRoutes(deps));
  app.route('/api/app/organizations', createOrganizationRoutes(deps));
  app.route('/api/app/products', createProductRoutes(deps));
  app.route('/api/app/projects', createProjectRoutes(deps));
  app.route('/api/app/retention', createRetentionRoutes(deps));
  app.route('/api/app/providers', createProviderSettingRoutes(deps));
  app.route(
    '/api/app/provider-credentials',
    createProviderCredentialRoutes(deps),
  );
  app.route('/api/app/sandbox', createSandboxRoutes(deps));
  app.route('/api/app/skills', createSkillRoutes(deps));
  app.route('/api/app/tasks', createTaskRoutes(deps));
  app.route('/api/app/teams', createTeamRoutes(deps));
  app.route('/api/app/two-factor', createTwoFactorRoutes(deps));
  app.route('/api/app/video-links', createVideoLinkRoutes(deps));
  app.route('/api/app/user-preferences', createUserPreferenceRoutes(deps));
  app.route('/api/app/users', createUserRoutes(deps));
  app.route('/api/app/websites', createWebsiteRoutes(deps));
  return app;
}
