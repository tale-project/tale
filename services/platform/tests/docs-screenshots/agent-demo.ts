/**
 * Drives a coding agent's sign-in against the capture stack through the real
 * product, the way the agent and the person do: the agent registers itself
 * (RFC 7591) and sends the browser to the authorization endpoint; the person
 * chooses on the consent page and connects; the agent exchanges its code and
 * calls the MCP endpoint. Nothing is written to the database directly, so
 * what a shot shows is what the product made.
 */

import { expect, type Page } from '@playwright/test';

import { TIMEOUT } from '../e2e/helpers/env';
import type { DEMO_AGENTS } from './demo-content';
import { t } from './i18n';

type DemoAgent = (typeof DEMO_AGENTS)[number];

/** Everything an agent can ask for, so the page offers every choice. */
const ALL_AGENT_SCOPES = [
  'tale:mcp',
  'tale:automations.write',
  'tale:automations.deploy',
  'tale:settings.read',
  'tale:settings.write',
  'tale:subscriptions.connect',
  'offline_access',
].join(' ');

/** Where a local agent listens for its answer; nothing does here. */
const AGENT_PORT = 54545;
const AGENT_CALLBACK = new RegExp(`^http://127\\.0\\.0\\.1:${AGENT_PORT}/`);

const LEVEL_LABEL = {
  read: 'agentConnections.consent.access.read.label',
  edit: 'agentConnections.consent.access.edit.label',
  deploy: 'agentConnections.consent.access.deploy.label',
} as const;

const EXTRA_LABEL = {
  settingsRead: 'agentConnections.consent.extras.settingsRead',
  settingsWrite: 'agentConnections.consent.extras.settingsWrite',
  subscriptions: 'agentConnections.consent.extras.subscriptions',
} as const;

interface RegisteredAgent {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly verifier: string;
  readonly redirectUri: string;
}

/** The label as the start of an accessible name: a choice's description
 * follows its label in the name. */
function startsWith(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** The agent registers itself and builds the address that opens its sign-in.
 * Runs in the page, on the app's own origin. */
async function register(page: Page, name: string): Promise<RegisteredAgent> {
  return page.evaluate(
    async ({ appName, scope, port }) => {
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const registered = await fetch('/api/auth/oauth2/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: appName,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope,
        }),
      });
      if (!registered.ok) {
        throw new Error(`Registering ${appName} answered ${registered.status}`);
      }
      const { client_id: clientId } = (await registered.json()) as {
        client_id: string;
      };
      const base64Url = (bytes: Uint8Array): string =>
        btoa(String.fromCharCode(...bytes))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replace(/=+$/, '');
      const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64Url(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      const url = new URL('/api/auth/oauth2/authorize', window.location.origin);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state: 'docs',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: `${window.location.origin}/api/v1/mcp`,
      }).toString();
      return { authorizeUrl: url.toString(), clientId, verifier, redirectUri };
    },
    { appName: name, scope: ALL_AGENT_SCOPES, port: AGENT_PORT },
  );
}

/** Opens the consent page of a freshly registered agent and waits for its
 * choices. Nothing is allowed: the agent is left registered, never connected. */
export async function openConsentPage(
  page: Page,
  name: string,
): Promise<RegisteredAgent> {
  const agent = await register(page, name);
  await page.goto(agent.authorizeUrl, { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', {
      name: t('agentConnections.consent.connect'),
      exact: true,
    }),
  ).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
  return agent;
}

/** What the person chooses on the consent page, then Connect. */
async function allow(page: Page, agent: DemoAgent): Promise<void> {
  await page
    .getByRole('radio', { name: startsWith(t(LEVEL_LABEL[agent.level])) })
    .click();
  for (const extra of agent.extras) {
    await page
      .getByRole('checkbox', { name: startsWith(t(EXTRA_LABEL[extra])) })
      .click();
  }
  // An access beyond reading asks for a sign-in from the last day. The
  // runner's own is as old as its state directory: say so, instead of
  // photographing a password prompt nobody asked for.
  const freshness = page.getByRole('group', {
    name: t('agentConnections.consent.fresh.title'),
  });
  if (await freshness.isVisible()) {
    throw new Error(
      'The saved sign-in is older than a day, so the consent page asks for the password. Bootstrap a fresh state directory.',
    );
  }
  await page
    .getByRole('button', {
      name: t('agentConnections.consent.connect'),
      exact: true,
    })
    .click();
}

/** The agent exchanges the code it was sent and calls the endpoint once, so
 * the list has a last use to show. Runs on the app's origin. */
async function callEndpoint(
  page: Page,
  agent: RegisteredAgent,
  code: string,
): Promise<void> {
  await page.evaluate(
    async ({ clientId, verifier, redirectUri, authCode }) => {
      const token = await fetch('/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
          resource: `${window.location.origin}/api/v1/mcp`,
        }),
      });
      if (!token.ok) throw new Error(`The token answered ${token.status}`);
      const { access_token: accessToken } = (await token.json()) as {
        access_token: string;
      };
      const call = await fetch('/api/v1/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      if (!call.ok) throw new Error(`The endpoint answered ${call.status}`);
    },
    { ...agent, authCode: code },
  );
}

/** Connects one agent through the consent page and, if it is to have used its
 * sign-in, lets it call the endpoint. Leaves the page on the app. */
async function connect(
  page: Page,
  agent: DemoAgent,
  appRoute: string,
): Promise<void> {
  await page.context().route(AGENT_CALLBACK, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'The agent received its answer.',
    }),
  );
  try {
    const registered = await openConsentPage(page, agent.name);
    await allow(page, agent);
    await page.waitForURL(AGENT_CALLBACK, { timeout: TIMEOUT.FIRST_PAINT });
    const code = new URL(page.url()).searchParams.get('code');
    if (code === null) throw new Error(`${agent.name} was sent no code`);
    await page.goto(appRoute, { waitUntil: 'domcontentloaded' });
    if (agent.calls) await callEndpoint(page, registered, code);
  } finally {
    await page.context().unroute(AGENT_CALLBACK);
  }
}

/** Connects the demo agents the organization does not hold yet, so a rerun
 * adds nothing. Ends on the list's own route. */
export async function ensureDemoAgents(
  page: Page,
  orgId: string,
  agents: readonly DemoAgent[],
): Promise<void> {
  const route = `/dashboard/${orgId}/settings/api/agents`;
  const held = await page.evaluate(async (organizationId) => {
    const response = await fetch(
      `/api/app/agent-connections?orgId=${organizationId}&scope=mine&ended=false`,
      { credentials: 'include' },
    );
    if (!response.ok) throw new Error(`The list answered ${response.status}`);
    const body = (await response.json()) as {
      connections: { clientName: string }[];
    };
    return body.connections.map((connection) => connection.clientName);
  }, orgId);
  for (const agent of agents) {
    if (!held.includes(agent.name)) await connect(page, agent, route);
  }
  await page.goto(route, { waitUntil: 'domcontentloaded' });
}
