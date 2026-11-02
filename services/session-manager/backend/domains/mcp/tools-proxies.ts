// The proxy pool.

import { z } from 'zod';

import { proxyListSchema, schemeSchema } from '../../../lib/api/schemas.ts';
import type { Proxy } from '../../../lib/api/schemas.ts';
import { importedText, proxyText } from './format.ts';
import { DESTRUCTIVE, READ_ONLY, defineTool, json } from './tool.ts';
import { CHECK_TIMEOUT, paced, sleepWhileOn } from './waiting.ts';

const POLL = 300;
const FILTERS = ['all', 'free', 'in_use', 'failed'] as const;

/** Is it one a new session could take (not used, not failed, no exit IP that a session has)? */
function isFree(proxy: Proxy): boolean {
  return (
    proxy.session === null &&
    proxy.check.status !== 'failed' &&
    proxy.sameIpAs === null
  );
}

function matches(proxy: Proxy, only: (typeof FILTERS)[number]): boolean {
  if (only === 'free') return isFree(proxy);
  if (only === 'in_use') return proxy.session !== null;
  return only !== 'failed' || proxy.check.status === 'failed';
}

const listProxies = defineTool({
  name: 'list_proxies',
  group: 'proxies',
  title: 'List proxies',
  description:
    'The proxy pool, newest first: address (without password), health, exit IP, country and the session that has it. `only` narrows it to the free ones (a new session could take them), the ones in use by a session, or the ones whose last check failed. At most `limit` are shown.',
  input: z.strictObject({
    only: z.enum(FILTERS).default('all').describe('Which proxies to list.'),
    limit: z.int().default(100).describe('The most proxies to list.'),
  }),
  annotations: READ_ONLY,
  routes: ['GET /proxies'],
  async run({ only, limit }, { manager }) {
    const proxies = manager.listProxies();
    const matching = proxies.filter((proxy) => matches(proxy, only));
    return json({
      total: proxies.length,
      matching: matching.length,
      proxies: matching.slice(0, Math.max(limit, 1)).map(proxyText),
    });
  },
});

const addProxies = defineTool({
  name: 'add_proxies',
  group: 'proxies',
  title: 'Add proxies',
  description:
    'Add proxies, one per line: host:port, host:port:user:pass, user:pass@host:port, http://user:pass@host:port, socks5://... Lines without a scheme get `default_scheme`. They are checked in the background (see list_proxies); every session needs one of its own. Tells which lines were added, duplicates or wrong.',
  input: z.strictObject({
    text: proxyListSchema.describe('The proxies, one per line.'),
    default_scheme: schemeSchema
      .default('http')
      .describe('The scheme of the lines that name none.'),
  }),
  routes: ['POST /proxies', 'POST /proxies/import'],
  async run({ text, default_scheme }, { manager }) {
    return json(
      importedText(
        manager.importProxies(text, { defaultScheme: default_scheme }),
      ),
    );
  },
});

const checkProxy = defineTool({
  name: 'check_proxy',
  group: 'proxies',
  title: 'Check a proxy',
  description:
    'Check one proxy now (its exit IP, country and speed) and return the result.',
  input: z.strictObject({
    proxy_id: z.int().describe('The id of the proxy (see list_proxies).'),
  }),
  routes: ['POST /proxies/:id/check'],
  async run({ proxy_id }, context) {
    const { manager } = context;
    manager.checkProxy(proxy_id);
    const deadline = Date.now() + CHECK_TIMEOUT;
    let proxy = manager.proxy(proxy_id);
    // As it is when the time is up: its health says it is still being checked.
    while (proxy.check.status === 'checking' && Date.now() < deadline) {
      await sleepWhileOn(context, paced(context, POLL));
      proxy = manager.proxy(proxy_id);
    }
    return json(proxyText(proxy));
  },
});

const checkProxies = defineTool({
  name: 'check_proxies',
  group: 'proxies',
  title: 'Check all proxies',
  description:
    'Check every proxy again in the background (see list_proxies for the results).',
  input: z.strictObject({}),
  routes: ['POST /proxies/check-all'],
  async run(_args, { manager }) {
    return `Checking ${manager.checkAllProxies().length} proxies.`;
  },
});

const deleteProxy = defineTool({
  name: 'delete_proxy',
  group: 'proxies',
  title: 'Delete a proxy',
  description:
    'Remove a proxy from the pool. A proxy that a running session uses cannot be removed. One that a stopped session has is only removed with `force` (the session gets another proxy at its next start).',
  input: z.strictObject({
    proxy_id: z.int().describe('The id of the proxy (see list_proxies).'),
    force: z
      .boolean()
      .default(false)
      .describe('Also remove a proxy that a stopped session has.'),
  }),
  annotations: DESTRUCTIVE,
  routes: ['DELETE /proxies/:id'],
  async run({ proxy_id, force }, { manager }) {
    manager.deleteProxy(proxy_id, { force });
    return `Deleted proxy ${proxy_id}.`;
  },
});

export const proxyTools = [
  listProxies,
  addProxies,
  checkProxy,
  checkProxies,
  deleteProxy,
];
