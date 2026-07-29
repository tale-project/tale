/**
 * Contract tests for the third-party connector mocks.
 *
 * Two guarantees:
 *   1. `resolveMockUrl` (registry) maps each real upstream origin to the right
 *      mount prefix — the contract the Convex sandbox rewrite mirror
 *      (`mock_rewrite.ts`) must keep in lockstep.
 *   2. The gateway serves each documented operation in exactly the shape the
 *      shipped connector parses (arrays for list ops, `.items` for search, an
 *      object for get/create), validated against the spec by Prism.
 *
 * The end-to-end "real connector → rewrite → gateway" path is exercised offline
 * by the Playwright suite and the container smoke test; here we pin the spec
 * shapes the connectors depend on.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createGatewayHandler } from '../gateway';
import { resolveMockUrl } from '../registry';
import { readJson } from './json';

const BASE = 'http://127.0.0.1:4141';
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  handle = await createGatewayHandler();
});
afterAll(() => {});

const get = (path: string) => handle(new Request(`${BASE}${path}`));
const post = (path: string, body: unknown) =>
  handle(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const getJson = async (path: string) => readJson(await get(path));
const postJson = async (path: string, body: unknown) =>
  readJson(await post(path, body));

describe('registry resolveMockUrl (rewrite contract)', () => {
  test('maps GitHub origin to /mock/github, preserving path + query', () => {
    expect(
      resolveMockUrl('https://api.github.com/repos/o/r?per_page=5', BASE),
    ).toBe(`${BASE}/mock/github/repos/o/r?per_page=5`);
  });

  test('maps Slack origin to /mock/slack', () => {
    expect(
      resolveMockUrl('https://slack.com/api/conversations.list', BASE),
    ).toBe(`${BASE}/mock/slack/api/conversations.list`);
  });

  test('maps any *.atlassian.net subdomain to /mock/confluence', () => {
    expect(
      resolveMockUrl(
        'https://acme.atlassian.net/wiki/rest/api/content/search?cql=x',
        BASE,
      ),
    ).toBe(`${BASE}/mock/confluence/wiki/rest/api/content/search?cql=x`);
  });

  test('returns null for an unmapped host', () => {
    expect(resolveMockUrl('https://example.com/foo', BASE)).toBeNull();
  });
});

describe('GitHub gateway shapes (connector contract)', () => {
  test('get_repo → object with full_name', async () => {
    const res = await get('/mock/github/repos/octocat/hello');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(typeof body.full_name).toBe('string');
  });

  test('list_repos → array (connector reads .length)', async () => {
    const body = await getJson('/mock/github/user/repos?per_page=5');
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].full_name).toBeDefined();
  });

  test('list_issues → array', async () => {
    const body = await getJson('/mock/github/repos/o/r/issues');
    expect(Array.isArray(body)).toBe(true);
    expect(typeof body[0].number).toBe('number');
  });

  test('get_issue → object', async () => {
    const body = await getJson('/mock/github/repos/o/r/issues/1347');
    expect(body.number).toBe(1347);
  });

  test('list_commits → array with sha', async () => {
    const body = await getJson('/mock/github/repos/o/r/commits');
    expect(Array.isArray(body)).toBe(true);
    expect(typeof body[0].sha).toBe('string');
  });

  test('search_code → object with items + total_count', async () => {
    const body = await getJson('/mock/github/search/code?q=foo');
    expect(typeof body.total_count).toBe('number');
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('/user (test connection) → object with login', async () => {
    const body = await getJson('/mock/github/user');
    expect(typeof body.login).toBe('string');
  });
});

describe('other connector gateways serve connector-shaped responses', () => {
  test('slack conversations.list → { ok, channels[] }', async () => {
    const body = await postJson('/mock/slack/api/conversations.list', {});
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.channels)).toBe(true);
  });

  test('discord list guilds → array', async () => {
    const body = await getJson('/mock/discord/api/v10/users/@me/guilds');
    expect(Array.isArray(body)).toBe(true);
  });

  test('microsoft graph list messages → { value[] }', async () => {
    const body = await getJson('/mock/microsoft-graph/v1.0/me/messages');
    expect(Array.isArray(body.value)).toBe(true);
  });

  test('gmail list messages → { messages[] }', async () => {
    const body = await getJson('/mock/gmail/gmail/v1/users/me/messages');
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test('google drive list files → { files[] }', async () => {
    const body = await getJson('/mock/google-drive/drive/v3/files');
    expect(Array.isArray(body.files)).toBe(true);
  });

  test('twilio list messages → { messages[] }', async () => {
    const body = await getJson(
      '/mock/twilio/2010-04-01/Accounts/ACxxx/Messages.json',
    );
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test('tavily search → { results[] }', async () => {
    const body = await postJson('/mock/tavily/search', { query: 'x' });
    expect(Array.isArray(body.results)).toBe(true);
  });

  test('shopify list products → { products[] }', async () => {
    const body = await getJson('/mock/shopify/admin/api/2026-01/products.json');
    expect(Array.isArray(body.products)).toBe(true);
  });

  test('confluence content search → { results[] }', async () => {
    const body = await getJson(
      '/mock/confluence/wiki/rest/api/content/search?cql=x',
    );
    expect(Array.isArray(body.results)).toBe(true);
  });
});
