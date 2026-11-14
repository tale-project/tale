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

import {
  connectorLiveBody,
  connectorSchema,
  type Connector,
} from '@tale/shared/schemas/connectors';
import { describe, expect, it } from 'vitest';

import { inProcessLiveRunner } from '../../connectors/in-process-live';
import {
  assignable,
  elementOf,
  lookup,
  nullability,
  shapeOfValue,
  type Shape,
} from '../../engine/core/typing/shape';
import { parseSignature } from '../../engine/core/typing/signature';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import { parseYamlOrThrow } from '../config/yaml';

const CONNECTORS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../../configs/platform/system/connectors',
);

/** The connectors the image ships. Pinned so that deleting one — or landing a
 * directory without its connector.yml — fails loudly instead of silently
 * shrinking the catalog. */
const EXPECTED_SLUGS = [
  'automation',
  'confluence',
  'conversation',
  'discord',
  'document',
  'forgejo',
  'github',
  'glitchtip',
  'gmail',
  'google-drive',
  'http',
  'imap-smtp',
  'jev',
  'knowledge',
  'notify',
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
    '%s: every oauth2 and client-credentials method carries https endpoints',
    (slug) => {
      for (const method of loadConnector(slug).auth) {
        if (method.method === 'client-credentials') {
          expect(method.tokenUrl.startsWith('https://')).toBe(true);
          continue;
        }
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
    const connector = loadConnector(slug);
    for (const action of connector.actions) {
      if (action.backend?.kind !== 'yaml-js') continue;
      // With its connector's prelude, as every runner runs it: a name the
      // body declares again would only fail here.
      const error = await runner.checkBody(
        connectorLiveBody(connector, action.backend.live),
        { async: true },
      );
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

  it('imap-smtp: smtp port and security defaults agree on the TLS mode', () => {
    // normalizeConfig applies every declared default when the form leaves a
    // field blank. tls+587 (or starttls+465) is OpenSSL's wrong version number
    // on the live send path — keep the pair coherent.
    const fields = Object.fromEntries(
      loadConnector('imap-smtp').configFields.map((field) => [
        field.key,
        field,
      ]),
    );
    expect(fields.security?.default).toBe('tls');
    expect(fields.smtpPort?.default).toBe(465);
    expect(fields.imapPort?.default).toBe(993);
    expect(fields.smtpPort).toMatchObject({
      integer: true,
      min: 1,
      max: 65535,
    });
    expect(fields.imapPort).toMatchObject({
      integer: true,
      min: 1,
      max: 65535,
    });
  });

  // ctx.http carries at most 5 MiB of response and Gmail sends attachment
  // bytes base64url inside JSON: fetching a bigger part throws and fails the
  // whole action — after the parts before it were already stored.
  it.each(['get_message', 'get_attachments'])(
    'gmail: %s lists a part too large to carry as truncated instead of fetching it',
    async (actionName) => {
      const action = loadConnector('gmail').actions.find(
        (a) => a.name === actionName,
      );
      if (action?.backend?.kind !== 'yaml-js') {
        throw new Error(`gmail.${actionName} has no yaml-js live body`);
      }
      const big = 4 * 1024 * 1024;
      const fetched: string[] = [];
      const ctx = {
        http: {
          get: async (url: string) => {
            fetched.push(url);
            const body = url.includes('/attachments/')
              ? { data: Buffer.from('pdf').toString('base64url') }
              : {
                  id: 'm1',
                  payload: {
                    parts: [
                      {
                        mimeType: 'application/pdf',
                        filename: 'small.pdf',
                        body: { attachmentId: 'small', size: 3 },
                      },
                      {
                        mimeType: 'application/pdf',
                        filename: 'big.pdf',
                        body: { attachmentId: 'big', size: big },
                      },
                    ],
                  },
                };
            return {
              status: 200,
              json: () => body,
              text: () => JSON.stringify(body),
            };
          },
        },
        files: {
          store: async (_data: string, opts: { fileName: string }) => ({
            id: `s3:org/${opts.fileName}`,
          }),
        },
      };

      const out = (await inProcessLiveRunner().runBody(
        action.backend.live,
        { input: { messageId: 'm1', includeAttachments: true }, ctx },
        LIMITS,
        { async: true },
      )) as { attachments: unknown[] };

      expect(out.attachments).toEqual([
        {
          id: 'small',
          filename: 'small.pdf',
          contentType: 'application/pdf',
          size: 3,
          fileId: 's3:org/small.pdf',
        },
        {
          id: 'big',
          filename: 'big.pdf',
          contentType: 'application/pdf',
          size: big,
          truncated: true,
        },
      ]);
      expect(fetched.some((url) => url.endsWith('/attachments/big'))).toBe(
        false,
      );
    },
  );

  // Shopify's count defaults to `status=open`, so a bare count leaves out the
  // closed and cancelled orders the description promises to count.
  it('shopify: count_orders asks for every order status', async () => {
    const action = loadConnector('shopify').actions.find(
      (a) => a.name === 'count_orders',
    );
    if (action?.backend?.kind !== 'yaml-js') {
      throw new Error('shopify.count_orders has no yaml-js live body');
    }
    const requested: string[] = [];
    const ctx = {
      endpoint: 'https://acme.myshopify.com',
      secrets: { get: () => 'shpat_test' },
      http: {
        get: async (url: string) => {
          requested.push(url);
          const body = { count: 3 };
          return {
            status: 200,
            json: () => body,
            text: () => JSON.stringify(body),
          };
        },
      },
    };

    const out = await inProcessLiveRunner().runBody(
      action.backend.live,
      { input: {}, ctx },
      LIMITS,
      { async: true },
    );

    expect(out).toEqual({ count: 3 });
    expect(requested).toEqual([
      'https://acme.myshopify.com/admin/api/2026-01/orders/count.json?status=any',
    ]);
  });

  // Shopify answers null for an order no line item has shipped for, so each
  // order's fulfillment_status must admit null in the declared output, and the
  // list_orders mock must answer that same null for its unfulfilled order.
  describe('shopify orders: fulfillment_status admits null', () => {
    function shopifyAction(actionName: string) {
      const action = loadConnector('shopify').actions.find(
        (a) => a.name === actionName,
      );
      if (!action)
        throw new Error(`shopify.${actionName} is not in the catalog`);
      return action;
    }

    function declaredShape(actionName: string): Shape {
      const parsed = parseSignature(shopifyAction(actionName).output);
      if (!('shape' in parsed)) {
        throw new Error(
          `shopify.${actionName} output does not read: ${parsed.error.message}`,
        );
      }
      return parsed.shape;
    }

    function fulfillmentStatusOf(order: Shape): Shape {
      const found = lookup(order, 'fulfillment_status');
      if (found.kind !== 'found') {
        throw new Error('fulfillment_status is not declared on the order');
      }
      return found.shape;
    }

    it('list_orders declares an order fulfillment_status that can be null', () => {
      const orders = lookup(declaredShape('list_orders'), 'orders');
      if (orders.kind !== 'found') throw new Error('orders is not declared');
      expect(nullability(fulfillmentStatusOf(elementOf(orders.shape)))).toBe(
        'maybe',
      );
    });

    it('get_order declares an order fulfillment_status that can be null', () => {
      const order = lookup(declaredShape('get_order'), 'order');
      if (order.kind !== 'found') throw new Error('order is not declared');
      expect(nullability(fulfillmentStatusOf(order.shape))).toBe('maybe');
    });

    it('the list_orders mock answers null for its unfulfilled order and fits the declared output', async () => {
      const action = shopifyAction('list_orders');
      const out = (await runner.runBody(
        action.mock,
        { input: action.exampleInput ?? {} },
        LIMITS,
      )) as { orders: Array<{ fulfillment_status: unknown }> };
      expect(out.orders.map((o) => o.fulfillment_status)).toContain(null);
      expect(
        assignable(shapeOfValue(out), declaredShape('list_orders')),
      ).toBeNull();
    });
  });
});
