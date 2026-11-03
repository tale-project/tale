// The HTTP API over the real manager and the fake browser: the port of the old
// app's `tests/helpers/api.py` and of its `client` fixture. A flow test calls
// the routes the way the page does (`flow.client`), waits for the background
// work through the manager (`waitForStatus`, `waitForChecks`), and reaches the
// fakes through `flow.backend` and `flow.checker`.
//
//     let flow: Flow;
//     beforeEach(() => { flow = createFlow(); });
//     afterEach(() => flow.close());
//
//     const proxy = await addProxy(flow.client, '192.0.2.1:8080');
//     const created = await createSession(flow.client, 'a');
//     const running = await waitForStatus(flow, created.id, 'running');

import type { Hono } from 'hono';

import { proxySchema, sessionSchema } from '../../lib/api/schemas.ts';
import type { Proxy, Session, SessionStatus } from '../../lib/api/schemas.ts';
import { apiClient, expectJson, testApp } from './api-client.ts';
import type { ApiClient } from './api-client.ts';
import {
  createTestManager,
  waitForChecks as waitForManagerChecks,
  waitForStatus as waitForManagerStatus,
} from './harness.ts';
import type { TestManager, TestManagerOptions } from './harness.ts';

export interface Flow extends TestManager {
  app: Hono;
  client: ApiClient;
}

export function createFlow(options: TestManagerOptions = {}): Flow {
  const harness = createTestManager(options);
  const app = testApp(harness.manager);
  return { ...harness, app, client: apiClient(app) };
}

/** Adds a proxy through the API; its first check runs in the background. */
export async function addProxy(
  client: ApiClient,
  proxy: string,
  fields: Record<string, unknown> = {},
): Promise<Proxy> {
  const response = await client.post('/api/proxies', { proxy, ...fields });
  return expectJson(response, 201, proxySchema);
}

/** Creates (and so starts) a session; it is "starting" with a proxy assignment ahead. */
export async function createSession(
  client: ApiClient,
  name: string | null = null,
  fields: Record<string, unknown> = {},
): Promise<Session> {
  const response = await client.post('/api/sessions', { name, ...fields });
  return expectJson(response, 201, sessionSchema);
}

export async function getSession(
  client: ApiClient,
  sessionId: number,
): Promise<Session> {
  const response = await client.get(`/api/sessions/${sessionId}`);
  return expectJson(response, 200, sessionSchema);
}

/** Until the session has the status and no background activity. */
export async function waitForStatus(
  flow: Flow,
  sessionId: number,
  status: SessionStatus,
): Promise<Session> {
  await waitForManagerStatus(flow.manager, sessionId, status);
  return getSession(flow.client, sessionId);
}

/** Until no proxy check is queued or running. */
export function waitForChecks(flow: Flow): Promise<void> {
  return waitForManagerChecks(flow.manager);
}
