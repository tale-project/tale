/**
 * The shipped connector catalog is valid, complete, and executable.
 *
 * This walks every `configs/platform/system/connectors/<slug>/connector.yml`
 * and proves the properties the engine and the settings UI rely on: each file
 * parses and satisfies the connector schema, its `name` matches its directory,
 * every action's mock RUNS and is deterministic (the authoring loop's whole
 * premise), and every live body compiles. A connector that only type-checks but
 * whose mock throws would fail an author on their first test run.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../engine/runners/node-vm';
import { parseYamlOrThrow } from '../config/yaml';
import { connectorSchema, type Connector } from './connectors';

const CONNECTORS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../../configs/platform/system/connectors',
);

/** The connectors the image ships. Pinned so that deleting one — or landing a
 * directory without its connector.yml — fails loudly instead of silently
 * shrinking the catalog. */
const EXPECTED_SLUGS = [
  'confluence',
  'conversation',
  'discord',
  'document',
  'github',
  'gmail',
  'google-drive',
  'imap-smtp',
  'outlook',
  'sandbox',
  'shopify',
  'slack',
  'task',
  'tavily',
  'teams',
  'twilio',
  'webdav',
] as const;

const runner = nodeVmRunner();
const LIMITS = { timeoutMs: 2000 };

function loadConnector(slug: string): Connector {
  const file = path.join(CONNECTORS_DIR, slug, 'connector.yml');
  const data = parseYamlOrThrow(readFileSync(file, 'utf8'), {
    maxBytes: 1024 * 1024,
  });
  return connectorSchema.parse(data);
}

const presentSlugs = readdirSync(CONNECTORS_DIR)
  .filter((entry) => statSync(path.join(CONNECTORS_DIR, entry)).isDirectory())
  .sort();

describe('shipped connector catalog', () => {
  it('ships exactly the expected connector set', () => {
    expect(presentSlugs).toEqual([...EXPECTED_SLUGS]);
  });

  it.each([...EXPECTED_SLUGS])('%s: name matches its directory', (slug) => {
    expect(loadConnector(slug).name).toBe(slug);
  });

  it.each([...EXPECTED_SLUGS])(
    '%s: every oauth2 method carries https endpoints',
    (slug) => {
      for (const method of loadConnector(slug).auth) {
        if (method.method !== 'oauth2') continue;
        expect(method.authorizeUrl.startsWith('https://')).toBe(true);
        expect(method.tokenUrl.startsWith('https://')).toBe(true);
      }
    },
  );

  it.each([...EXPECTED_SLUGS])(
    '%s: a per-credential connector reads ctx.endpoint, a fixed one does not',
    (slug) => {
      const connector = loadConnector(slug);
      const bodies = connector.actions
        .map((a) => (a.backend?.kind === 'yaml-js' ? a.backend.live : ''))
        .join('\n');
      if (bodies.trim() === '') return;
      if (connector.endpointMode === 'per-credential') {
        expect(bodies).toContain('ctx.endpoint');
      } else {
        expect(bodies).not.toContain('ctx.endpoint');
      }
    },
  );

  // Live bodies call the network, so they are compiled as async — `await
  // ctx.http.get(...)` is their normal shape.
  it.each([...EXPECTED_SLUGS])('%s: every live body compiles', async (slug) => {
    for (const action of loadConnector(slug).actions) {
      if (action.backend?.kind !== 'yaml-js') continue;
      const error = await runner.checkBody(action.backend.live, {
        async: true,
      });
      expect(error, `${slug}.${action.name} live body: ${error}`).toBeNull();
    }
  });

  it.each([...EXPECTED_SLUGS])(
    '%s: every mock runs and is deterministic',
    async (slug) => {
      for (const action of loadConnector(slug).actions) {
        const input = action.exampleInput ?? {};
        const first = await runner.runBody(action.mock, { input }, LIMITS);
        const second = await runner.runBody(action.mock, { input }, LIMITS);
        expect(
          first,
          `${slug}.${action.name} mock returned nothing`,
        ).toBeDefined();
        expect(
          JSON.stringify(second),
          `${slug}.${action.name} mock is not deterministic`,
        ).toBe(JSON.stringify(first));
      }
    },
  );
});
