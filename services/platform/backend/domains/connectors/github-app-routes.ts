import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import { sessionAllowsOrganization } from '../../auth/session-authority.ts';
import {
  requireSession,
  type AuthEnv,
  type SessionBundle,
} from '../../auth/session.ts';
import {
  buildGithubAppManifest,
  convertManifestCode,
  getBotUserId,
  GITHUB_APP_NAME_MAX,
  GITHUB_LOGIN_RE,
  githubAppInstallUrl,
  githubAppRegistrationUrl,
} from '../../core/connector_credentials/github_app.ts';
import {
  resolveConnectorSettingsUrl,
  resolvePublicBaseUrl,
} from '../../core/http_connectors/deployment_config.ts';
import type { FetchLike } from '../../core/http_connectors/token_exchange.ts';
import {
  basePath,
  publicOrigin,
} from '../../core/lib/helpers/public_origin.ts';
import {
  assertGithubAppCredentialCreatable,
  ConnectorCredentialError,
  createGithubAppCredentialInTransaction,
  findGithubAppCredentialsByInstallation,
  getCredential,
  listGithubAppInstallations,
  readGithubAppInstallation,
  recordGithubAppInstallationInTransaction,
  type MaskedCredential,
} from '../connector_credentials/service.ts';
import {
  renderGithubAppHandoffPage,
  renderGithubAppPage,
  type GithubAppPageKind,
  type GithubAppPageOptions,
} from './github-app-pages.ts';
import {
  claimGithubAppState,
  createGithubAppState,
  githubAppAccess,
  githubAppAdminOrganizations,
  lockGithubAppAccess,
} from './github-app.ts';

/** Where these routes are mounted (`backend/app.ts`), under the public
 * base: the app's manifest names the two returns below it. */
export const GITHUB_APP_ROUTES_PATH = '/api/connectors/github-app';

/** Longer than any id a credential row carries — a probe, not a link. */
const CREDENTIAL_ID_MAX = 128;
/** Longer than any code GitHub hands out — never sent on to GitHub. */
const MANIFEST_CODE_MAX = 256;

/** Why GitHub's read of an installation was not stored, as the page that
 * says so. */
const INSTALLATION_REFUSAL_PAGE = {
  not_found: 'installation_not_found',
  wrong_app: 'installation_wrong_app',
  suspended: 'installation_suspended',
  rejected: 'installation_refused',
  malformed: 'installation_refused',
  unreachable: 'github_unreachable',
} as const satisfies Record<string, GithubAppPageKind>;

interface InstallationRefusal {
  readonly ok: false;
  readonly kind: GithubAppPageKind;
  /** The service's own words for it, quoted on the page. */
  readonly reason?: string;
}

type InstallationOutcome = { readonly ok: true } | InstallationRefusal;

/** GitHub's answer when the credential's app read an installation. */
type InstallationRead = Extract<
  Awaited<ReturnType<typeof readGithubAppInstallation>>,
  { ok: true }
>;

/** An installation id, and the credential whose app it is claimed for. */
interface InstallationTarget {
  readonly organizationId: string;
  readonly credentialId: string;
  readonly installationId: number;
}

/**
 * `/api/connectors/github-app` — the browser-facing halves of an
 * organization registering its own GitHub App and installing it
 * (`github-app.ts` holds the round trips' state).
 *
 * `register` and `install` are the doors Tale's connector settings open:
 * session-gated, for the organization's admins only, and refused when
 * opened from another site (`Sec-Fetch-Site: cross-site`) — a link
 * elsewhere still carries the Lax session cookie, and would otherwise
 * register an app or install one on the admin's behalf (CONN-R35).
 * `register` answers a page that posts the app's manifest to GitHub, which
 * asks for exactly the connector's permissions with the webhook off
 * (CONN-R34); `install` sends the browser to GitHub's installation page.
 *
 * `registered` and `installed` are where GitHub sends the browser back.
 * GitHub's request can choose nothing: the state row names the
 * organization, the member and (for an installation) the credential, and is
 * honoured once, for the member who began it, while they are still an
 * admin (CONN-R36). An installation is stored only as the app's own JWT
 * reads it from GitHub (CONN-R37) — the id in the URL is a claim, not a
 * fact. A change made on GitHub's own pages comes back without state; it
 * refreshes only the credentials that already hold that installation, in
 * organizations the returning member administers.
 *
 * Every answer a person sees is a page (`github-app-pages.ts`), not JSON:
 * they are in a browser tab, mid-flow, and need a way back to settings.
 */
export function createConnectorGithubAppRoutes(deps: {
  sql: Sql;
  auth: Auth;
  /** GitHub's transport — injected only by tests. */
  fetchImpl?: FetchLike;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;

  const plainText = (body: string, status: 403): Response =>
    new Response(body, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        // The answer depends on the session cookie; a caching proxy keying
        // only on the URL would serve one member's outcome to another.
        Vary: 'Cookie',
      },
    });

  const redirect = (location: string): Response =>
    new Response(null, {
      status: 302,
      headers: {
        Location: location,
        // The URL carries a state token; keep it out of every cache.
        'Cache-Control': 'no-store',
        // No Referrer-Policy of its own: the deployment's security headers
        // (`backendSecureHeaders`) set `strict-origin-when-cross-origin` on
        // every answer, over any a route sets. A redirect hands on the
        // referrer its navigation began with, never its own URL, so GitHub
        // learns no more of Tale than its origin.
        Vary: 'Cookie',
      },
    });

  /** The connector settings of `organizationId`, on the domain the browser
   * is on; relative when the deployment has no public address. */
  const settingsUrl = (organizationId: string, base: string | null): string =>
    resolveConnectorSettingsUrl(organizationId, base) ??
    `${basePath()}/dashboard/${encodeURIComponent(organizationId)}/settings/connectors`;

  /** Where a page links back to before the round trip's organization is
   * known to be the reader's: their own active organization, if any. */
  const ownSettingsUrl = (
    session: SessionBundle | null,
    base: string | null,
  ): string | null => {
    const active = session?.session.activeOrganizationId;
    return active === undefined || active === null || active === ''
      ? null
      : settingsUrl(active, base);
  };

  /** The returning browser's session — GitHub's returns are not behind
   * `requireSession`: a missing session is a page, not a JSON 401. */
  const returningSession = async (
    request: Request,
  ): Promise<SessionBundle | null> => {
    const cached = await deps.auth.api.getSession({
      headers: request.headers,
    });
    return cached === null
      ? null
      : await deps.auth.resolveSessionAuthority(cached);
  };

  /** The access refusals of a door, as plain text (the OAuth start's). */
  const doorAccess = async (
    session: SessionBundle,
    organizationId: string,
  ): Promise<Response | null> => {
    if (!sessionAllowsOrganization(session.session, organizationId)) {
      return plainText('You do not have access to this organization.', 403);
    }
    const access = await githubAppAccess(
      deps.sql,
      organizationId,
      session.user.id,
    );
    if (access === 'not_member') {
      // Same answer for "no such organization" and "not your organization":
      // the difference only helps someone enumerating org ids.
      return plainText('You do not have access to this organization.', 403);
    }
    if (access === 'role_forbidden') {
      return plainText(
        'Only organization admins can register or install a GitHub App.',
        403,
      );
    }
    return null;
  };

  /** Read installation `installationId` with the credential's own app
   * (CONN-R37): what GitHub answered — never what the URL claimed — or the
   * page that refuses it. */
  const readInstallation = async (
    target: InstallationTarget,
  ): Promise<
    { readonly ok: true; readonly read: InstallationRead } | InstallationRefusal
  > => {
    let read: Awaited<ReturnType<typeof readGithubAppInstallation>>;
    try {
      read = await readGithubAppInstallation(deps.sql, {
        organizationId: target.organizationId,
        credentialId: target.credentialId,
        installationId: target.installationId,
        fetchImpl,
      });
    } catch (error) {
      // The credential was removed since the door, or its key no longer
      // loads: nothing to read with, and nothing stored.
      if (!(error instanceof ConnectorCredentialError)) throw error;
      console.warn(
        `[connectors:github-app] could not read installation ${target.installationId} with credential ${target.credentialId} (organization ${target.organizationId}): ${error.code}`,
      );
      return { ok: false, kind: 'credential_missing', reason: error.message };
    }
    if (!read.ok) {
      console.warn(
        `[connectors:github-app] did not store installation ${target.installationId} on credential ${target.credentialId} (organization ${target.organizationId}): ${read.reason}`,
      );
      return {
        ok: false,
        kind: INSTALLATION_REFUSAL_PAGE[read.reason],
        reason: read.message,
      };
    }
    return { ok: true, read };
  };

  /**
   * Store what the app's read of an installation answered, for the member
   * `session` names. The write repeats the admin check under the membership
   * row's lock: GitHub's pages can outlive the check before them.
   */
  const storeInstallation = async (
    target: InstallationTarget,
    read: InstallationRead,
    session: SessionBundle,
  ): Promise<InstallationOutcome> => {
    try {
      const stored = await deps.sql.begin(async (tx) => {
        if (
          !(await lockGithubAppAccess(
            tx,
            target.organizationId,
            session.user.id,
          ))
        ) {
          return false;
        }
        await recordGithubAppInstallationInTransaction(tx, {
          organizationId: target.organizationId,
          credentialId: target.credentialId,
          installation: read.installation,
          ...(read.repositories !== undefined && {
            repositories: read.repositories,
          }),
          ...(read.repositoryCount !== undefined && {
            repositoryCount: read.repositoryCount,
          }),
          actor: { userId: session.user.id, email: session.user.email },
        });
        return true;
      });
      if (!stored) {
        console.warn(
          `[connectors:github-app] did not store installation ${target.installationId}: the member is no longer an admin of organization ${target.organizationId}`,
        );
        return { ok: false, kind: 'forbidden' };
      }
    } catch (error) {
      if (!(error instanceof ConnectorCredentialError)) throw error;
      console.warn(
        `[connectors:github-app] did not store installation ${target.installationId} on credential ${target.credentialId} (organization ${target.organizationId}): ${error.code}`,
      );
      return { ok: false, kind: 'credential_missing', reason: error.message };
    }
    return { ok: true };
  };

  /** Read an installation with the credential's own app and store it. */
  const recordInstallation = async (
    target: InstallationTarget,
    session: SessionBundle,
  ): Promise<InstallationOutcome> => {
    const read = await readInstallation(target);
    return read.ok ? storeInstallation(target, read.read, session) : read;
  };

  /**
   * Whether the credential already holds, in service, what the app's read
   * of its installation answered — the account, its kind and the
   * repository selection (a suspension never gets this far: the read
   * refuses it). A return without state stores nothing then: it is a
   * cross-site navigation a link elsewhere can start, and only a change on
   * GitHub is worth a write and its audit entry.
   */
  const holdsAlready = async (
    target: InstallationTarget,
    read: InstallationRead,
  ): Promise<boolean> => {
    let credential: MaskedCredential;
    try {
      credential = await getCredential(
        deps.sql,
        target.organizationId,
        target.credentialId,
      );
    } catch (error) {
      // Removed since it was found: the write that follows says so.
      if (!(error instanceof ConnectorCredentialError)) throw error;
      console.warn(
        `[connectors:github-app] could not compare installation ${target.installationId} with credential ${target.credentialId} (organization ${target.organizationId}): ${error.code}`,
      );
      return false;
    }
    const held = credential.githubApp?.installation;
    return (
      credential.status !== 'needs-reauth' &&
      held !== undefined &&
      held.id === read.installation.id &&
      held.account === read.installation.account &&
      held.accountType === read.installation.accountType &&
      held.repositorySelection === read.installation.repositorySelection
    );
  };

  /** The page a refused installation shows, linking back to its own
   * organization's settings unless the member lost their access there. */
  const refusalPage = (
    refusal: InstallationRefusal,
    organizationId: string,
    base: string | null,
    acceptLanguage: string | undefined,
  ): Response =>
    renderGithubAppPage(refusal.kind, {
      backUrl:
        refusal.kind === 'forbidden' ? null : settingsUrl(organizationId, base),
      acceptLanguage,
      ...(refusal.reason !== undefined && { reason: refusal.reason }),
    });

  app.get('/register', requireSession(deps.auth), async (c) => {
    const organizationId = c.req.query('organizationId') ?? '';
    const connectorSlug = c.req.query('connectorSlug') ?? '';
    const credentialName = c.req.query('credentialName') ?? '';
    const appName = (c.req.query('appName') ?? '').trim();
    const owner = (c.req.query('owner') ?? '').trim();
    const acceptLanguage = c.req.header('accept-language');
    const session = c.get('sessionBundle');
    const page = (
      kind: GithubAppPageKind,
      options: Partial<GithubAppPageOptions> = {},
    ): Response =>
      renderGithubAppPage(kind, {
        backUrl:
          organizationId === ''
            ? null
            : settingsUrl(
                organizationId,
                resolvePublicBaseUrl(publicOrigin(c.req.raw)),
              ),
        acceptLanguage,
        ...options,
      });
    if (organizationId === '' || connectorSlug === '') {
      return page('cannot_register');
    }
    const refused = await doorAccess(session, organizationId);
    if (refused !== null) return refused;
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      console.warn(
        `[connectors:github-app] refused a "${connectorSlug}" registration opened from another site (organization ${organizationId})`,
      );
      return page('cross_site');
    }
    // GitHub counts the name's characters (code points), not its UTF-16
    // units or bytes.
    const appNameLength = Array.from(appName).length;
    if (
      appNameLength === 0 ||
      appNameLength > GITHUB_APP_NAME_MAX ||
      /\p{Cc}/u.test(appName) ||
      (owner !== '' && !GITHUB_LOGIN_RE.test(owner))
    ) {
      return page('invalid_details');
    }
    // GitHub sends the browser back to the domain it registered from: the
    // session cookie the returns need lives there.
    const base = resolvePublicBaseUrl(publicOrigin(c.req.raw));
    if (base === null) return page('not_configured');

    let permissions: Record<string, 'read' | 'write'>;
    try {
      ({ permissions } = await assertGithubAppCredentialCreatable(deps.sql, {
        organizationId,
        connectorSlug,
        name: credentialName,
      }));
    } catch (error) {
      if (!(error instanceof ConnectorCredentialError)) throw error;
      console.warn(
        `[connectors:github-app] refused a "${connectorSlug}" registration for organization ${organizationId}: ${error.code}`,
      );
      return page('cannot_register', {
        reason: error.message,
        status: error.status,
      });
    }

    const state = await createGithubAppState(deps.sql, {
      flow: 'register',
      organizationId,
      userId: session.user.id,
      config: {
        connectorSlug,
        credentialName,
        appName,
        ...(owner !== '' && { owner }),
      },
    });
    return renderGithubAppHandoffPage({
      actionUrl: githubAppRegistrationUrl(
        state,
        owner === '' ? undefined : owner,
      ),
      manifest: buildGithubAppManifest({
        name: appName,
        baseUrl: base,
        redirectUrl: `${base}${GITHUB_APP_ROUTES_PATH}/registered`,
        setupUrl: `${base}${GITHUB_APP_ROUTES_PATH}/installed`,
        permissions,
      }),
      appName,
      acceptLanguage,
    });
  });

  app.get('/registered', async (c) => {
    const session = await returningSession(c.req.raw);
    const base = resolvePublicBaseUrl(publicOrigin(c.req.raw));
    const acceptLanguage = c.req.header('accept-language');
    // GitHub created the app before it sent the browser here; whatever is
    // refused below, the app exists on GitHub without Tale holding it —
    // unless the return replays one that completed. A claimed state is
    // gone, so an unmatched return cannot tell: its note says how to.
    const code = c.req.query('code') ?? '';
    const claimed = await claimGithubAppState(
      deps.sql,
      c.req.query('state') ?? null,
      'register',
    );
    if (!claimed.ok) {
      console.warn(
        `[connectors:github-app] refused a registration return: its state is ${claimed.reason}`,
      );
      return renderGithubAppPage('register_expired', {
        backUrl: ownSettingsUrl(session, base),
        acceptLanguage,
        ...(code !== '' && { orphan: { kind: 'unmatched' } }),
      });
    }
    const { organizationId, userId, config } = claimed;
    if (
      session === null ||
      session.user.id !== userId ||
      !sessionAllowsOrganization(session.session, organizationId)
    ) {
      // Same page as a forged state: the completer learns nothing about
      // whose registration this was, and the state is already gone.
      console.warn(
        `[connectors:github-app] refused a registration return completed by ${
          session === null ? 'no session' : 'another member or realm'
        } than the one who started it (organization ${organizationId})`,
      );
      return renderGithubAppPage('register_expired', {
        backUrl: ownSettingsUrl(session, base),
        acceptLanguage,
        ...(code !== '' && { orphan: { kind: 'unmatched' } }),
      });
    }
    const backUrl = settingsUrl(organizationId, base);
    if (
      (await githubAppAccess(deps.sql, organizationId, userId)) !== 'allowed'
    ) {
      console.warn(
        `[connectors:github-app] refused a registration return: the member is no longer an admin of organization ${organizationId}`,
      );
      return renderGithubAppPage('forbidden', {
        backUrl: null,
        acceptLanguage,
        orphan: { kind: 'unknown' },
      });
    }
    if (code === '' || code.length > MANIFEST_CODE_MAX) {
      console.warn(
        `[connectors:github-app] a registration return for organization ${organizationId} carried no usable code`,
      );
      return renderGithubAppPage('github_refused', {
        backUrl,
        acceptLanguage,
        status: 400,
        orphan: { kind: 'unknown' },
      });
    }

    // The code buys the app's private key for an hour: it is never logged,
    // and never shown back, even inside GitHub's own message.
    const converted = await convertManifestCode(code, fetchImpl);
    if (!converted.ok) {
      console.warn(
        `[connectors:github-app] GitHub did not trade a registration's code for organization ${organizationId}: ${converted.reason}${
          converted.status === undefined ? '' : ` (${converted.status})`
        }`,
      );
      return renderGithubAppPage('github_refused', {
        backUrl,
        acceptLanguage,
        status:
          converted.reason === 'unreachable' || converted.reason === 'malformed'
            ? 502
            : 400,
        githubMessage: withoutCode(converted.message, code),
        orphan: { kind: 'unknown' },
      });
    }
    const registered = converted.value;
    // Best effort: the bot's id only links the app's commits to its
    // profile, and the app works without it.
    const bot = await getBotUserId(registered.slug, fetchImpl);
    if (!bot.ok) {
      console.warn(
        `[connectors:github-app] could not read the bot user of the app "${registered.slug}": ${bot.reason}${
          bot.status === undefined ? '' : ` (${bot.status})`
        }`,
      );
    }
    const orphan = {
      kind: 'known',
      name: registered.name,
      settingsUrl: githubAppSettingsUrl(registered.slug, config.owner),
    } as const;

    let installState: string | null;
    try {
      installState = await deps.sql.begin(async (tx) => {
        if (!(await lockGithubAppAccess(tx, organizationId, userId))) {
          return null;
        }
        const { credentialId } = await createGithubAppCredentialInTransaction(
          tx,
          {
            organizationId,
            connectorSlug: config.connectorSlug,
            name: config.credentialName,
            app: {
              appId: registered.appId,
              clientId: registered.clientId,
              slug: registered.slug,
              privateKey: registered.privateKey,
              ...(registered.owner !== undefined && {
                owner: registered.owner,
              }),
              ...(bot.ok && { botId: bot.value }),
            },
            createdBy: userId,
            actor: { userId, email: session.user.email },
          },
        );
        return createGithubAppState(tx, {
          flow: 'install',
          organizationId,
          userId,
          credentialId,
          config: { connectorSlug: config.connectorSlug },
        });
      });
    } catch (error) {
      // Only the error's kind: a failed write's message is no place to look
      // for the key that was being written.
      console.error(
        `[connectors:github-app] could not store the app "${registered.slug}" registered for organization ${organizationId}:`,
        error instanceof ConnectorCredentialError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'unknown error',
      );
      return renderGithubAppPage('register_storage_failed', {
        backUrl,
        acceptLanguage,
        ...(error instanceof ConnectorCredentialError && {
          reason: error.message,
        }),
        orphan,
      });
    }
    if (installState === null) {
      console.warn(
        `[connectors:github-app] did not store the app "${registered.slug}": the member is no longer an admin of organization ${organizationId}`,
      );
      return renderGithubAppPage('forbidden', {
        backUrl: null,
        acceptLanguage,
        orphan,
      });
    }
    return redirect(githubAppInstallUrl(registered.slug, installState));
  });

  app.get('/install', requireSession(deps.auth), async (c) => {
    const organizationId = c.req.query('organizationId') ?? '';
    const credentialId = c.req.query('credentialId') ?? '';
    const session = c.get('sessionBundle');
    const base = resolvePublicBaseUrl(publicOrigin(c.req.raw));
    const acceptLanguage = c.req.header('accept-language');
    const page = (kind: GithubAppPageKind, reason?: string): Response =>
      renderGithubAppPage(kind, {
        backUrl:
          organizationId === '' ? null : settingsUrl(organizationId, base),
        acceptLanguage,
        ...(reason !== undefined && { reason }),
      });
    if (organizationId === '') return page('credential_missing');
    const refused = await doorAccess(session, organizationId);
    if (refused !== null) return refused;
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      console.warn(
        `[connectors:github-app] refused an installation opened from another site (organization ${organizationId})`,
      );
      return page('cross_site');
    }
    if (credentialId === '' || credentialId.length > CREDENTIAL_ID_MAX) {
      return page('credential_missing');
    }
    let credential: MaskedCredential;
    try {
      credential = await getCredential(deps.sql, organizationId, credentialId);
    } catch (error) {
      if (!(error instanceof ConnectorCredentialError)) throw error;
      console.warn(
        `[connectors:github-app] refused an installation of credential ${credentialId} (organization ${organizationId}): ${error.code}`,
      );
      return page('credential_missing');
    }
    if (
      credential.authMethod !== 'github-app' ||
      credential.githubApp === undefined
    ) {
      return page('credential_missing');
    }
    const githubApp = credential.githubApp;

    // An installation GitHub already has — one an organization's owner
    // approved after a request, or one made on GitHub's own pages — has no
    // installation page left to go through: GitHub offers to configure it
    // instead, and may send the browser back without state. So the app
    // lists its installations with its own JWT first (a private app has
    // one at most), and Tale adopts the one it finds — read and stored as
    // any return's (CONN-R37). A credential that already holds it in
    // service goes on to GitHub, where its repositories change.
    let listed: Awaited<ReturnType<typeof listGithubAppInstallations>>;
    try {
      listed = await listGithubAppInstallations(deps.sql, {
        organizationId,
        credentialId,
        fetchImpl,
      });
    } catch (error) {
      // Removed since the read above, or a key that no longer loads.
      if (!(error instanceof ConnectorCredentialError)) throw error;
      console.warn(
        `[connectors:github-app] could not list the installations of credential ${credentialId} (organization ${organizationId}): ${error.code}`,
      );
      return page('credential_missing', error.message);
    }
    if (!listed.ok) {
      console.warn(
        `[connectors:github-app] did not install credential ${credentialId} (organization ${organizationId}): its app could not list its installations: ${listed.reason}${
          listed.status === undefined ? '' : ` (${listed.status})`
        }`,
      );
      return page(INSTALLATION_REFUSAL_PAGE[listed.reason], listed.message);
    }
    const [only, ...others] = listed.value;
    const held = githubApp.installation;
    if (
      only !== undefined &&
      others.length === 0 &&
      !(credential.status !== 'needs-reauth' && held?.id === only.id)
    ) {
      const outcome = await recordInstallation(
        { organizationId, credentialId, installationId: only.id },
        session,
      );
      if (!outcome.ok) {
        return refusalPage(outcome, organizationId, base, acceptLanguage);
      }
      return redirect(
        `${settingsUrl(organizationId, base)}?connected=${encodeURIComponent(credential.connectorSlug)}`,
      );
    }
    if (others.length > 0) {
      // A public app: GitHub's page lets the member choose which.
      console.warn(
        `[connectors:github-app] the app of credential ${credentialId} (organization ${organizationId}) has ${listed.value.length} installations; GitHub's page chooses`,
      );
    }
    const state = await createGithubAppState(deps.sql, {
      flow: 'install',
      organizationId,
      userId: session.user.id,
      credentialId,
      config: { connectorSlug: credential.connectorSlug },
    });
    return redirect(githubAppInstallUrl(githubApp.slug, state));
  });

  app.get('/installed', async (c) => {
    const session = await returningSession(c.req.raw);
    const base = resolvePublicBaseUrl(publicOrigin(c.req.raw));
    const acceptLanguage = c.req.header('accept-language');
    const state = c.req.query('state') ?? '';
    const installationId = parseInstallationId(
      c.req.query('installation_id') ?? '',
    );

    if (c.req.query('setup_action') === 'request') {
      // A GitHub organization's owners approve the installation first;
      // nothing is installed yet. The round trip is spent either way.
      const claimed =
        state === ''
          ? null
          : await claimGithubAppState(deps.sql, state, 'install');
      return renderGithubAppPage('install_requested', {
        backUrl:
          claimed?.ok === true &&
          session !== null &&
          session.user.id === claimed.userId &&
          sessionAllowsOrganization(session.session, claimed.organizationId)
            ? settingsUrl(claimed.organizationId, base)
            : ownSettingsUrl(session, base),
        acceptLanguage,
      });
    }

    if (state !== '') {
      const claimed = await claimGithubAppState(deps.sql, state, 'install');
      if (!claimed.ok) {
        console.warn(
          `[connectors:github-app] refused an installation return: its state is ${claimed.reason}`,
        );
        return renderGithubAppPage('install_expired', {
          backUrl: ownSettingsUrl(session, base),
          acceptLanguage,
        });
      }
      const { organizationId, userId, credentialId, config } = claimed;
      if (
        session === null ||
        session.user.id !== userId ||
        !sessionAllowsOrganization(session.session, organizationId)
      ) {
        console.warn(
          `[connectors:github-app] refused an installation return completed by ${
            session === null ? 'no session' : 'another member or realm'
          } than the one who started it (organization ${organizationId})`,
        );
        return renderGithubAppPage('install_expired', {
          backUrl: ownSettingsUrl(session, base),
          acceptLanguage,
        });
      }
      if (
        (await githubAppAccess(deps.sql, organizationId, userId)) !== 'allowed'
      ) {
        console.warn(
          `[connectors:github-app] refused an installation return: the member is no longer an admin of organization ${organizationId}`,
        );
        return renderGithubAppPage('forbidden', {
          backUrl: null,
          acceptLanguage,
        });
      }
      const backUrl = settingsUrl(organizationId, base);
      if (installationId === null) {
        return renderGithubAppPage('installation_missing', {
          backUrl,
          acceptLanguage,
        });
      }
      const outcome = await recordInstallation(
        { organizationId, credentialId, installationId },
        session,
      );
      if (!outcome.ok) {
        return refusalPage(outcome, organizationId, base, acceptLanguage);
      }
      return redirect(
        `${backUrl}?connected=${encodeURIComponent(config.connectorSlug)}`,
      );
    }

    // No state: a change made on GitHub's own pages (`setup_on_update`), or
    // an installation begun there. Only credentials that already hold the
    // installation, in organizations this member administers, are
    // refreshed — only with what the app itself reads from GitHub, and only
    // where that differs from what they hold: this GET is a cross-site
    // navigation, which a link on any site can start for a signed-in
    // admin.
    if (session === null) {
      return renderGithubAppPage('signed_out', {
        backUrl: null,
        acceptLanguage,
      });
    }
    if (installationId === null) {
      return renderGithubAppPage('installation_missing', {
        backUrl: ownSettingsUrl(session, base),
        acceptLanguage,
      });
    }
    const organizationIds = (
      await githubAppAdminOrganizations(deps.sql, session.user.id)
    ).filter((organizationId) =>
      sessionAllowsOrganization(session.session, organizationId),
    );
    const holders =
      organizationIds.length === 0
        ? []
        : await findGithubAppCredentialsByInstallation(deps.sql, {
            installationId,
            organizationIds,
          });
    if (holders.length === 0) {
      console.warn(
        `[connectors:github-app] installation ${installationId} came back without state, and no credential the member administers holds it`,
      );
      return renderGithubAppPage('installation_unknown', {
        backUrl: ownSettingsUrl(session, base),
        acceptLanguage,
      });
    }
    // Each holder is refreshed — written only where GitHub's answer differs
    // from what it holds; the first that holds the installation now
    // answers, else the first refusal.
    let refreshed: Response | null = null;
    let refused: Response | null = null;
    for (const holder of holders) {
      const target: InstallationTarget = {
        organizationId: holder.organizationId,
        credentialId: holder.id,
        installationId,
      };
      const read = await readInstallation(target);
      const outcome = !read.ok
        ? read
        : (await holdsAlready(target, read.read))
          ? ({ ok: true } as const)
          : await storeInstallation(target, read.read, session);
      if (outcome.ok) {
        refreshed ??= redirect(
          `${settingsUrl(holder.organizationId, base)}?connected=${encodeURIComponent(holder.connectorSlug)}`,
        );
      } else {
        refused ??= refusalPage(
          outcome,
          holder.organizationId,
          base,
          acceptLanguage,
        );
      }
    }
    return (
      refreshed ??
      refused ??
      renderGithubAppPage('installation_unknown', {
        backUrl: ownSettingsUrl(session, base),
        acceptLanguage,
      })
    );
  });

  return app;
}

/** GitHub's installation id: a positive integer, as GitHub's return spells
 * it, or null. */
function parseInstallationId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** GitHub's message without the code it may quote: the code still buys the
 * app's private key, and a page is no place for it. */
function withoutCode(message: string, code: string): string {
  return message
    .replaceAll(code, '…')
    .replaceAll(encodeURIComponent(code), '…');
}

/** Where the owner of a registered app deletes it on GitHub. */
function githubAppSettingsUrl(slug: string, owner: string | undefined): string {
  return owner === undefined
    ? `https://github.com/settings/apps/${encodeURIComponent(slug)}`
    : `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/${encodeURIComponent(slug)}`;
}
