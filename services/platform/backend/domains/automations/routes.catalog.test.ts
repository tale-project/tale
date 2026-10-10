import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeTypeCatalogSchema } from '../../../lib/shared/schemas/node-type-catalog.ts';
import type { OrgEnv } from '../../auth/org.ts';

/**
 * The node-type catalog the automation editor works against:
 * `GET /catalog/node-types` answers one row per shipped connector action and
 * the connectors themselves, once each, with what a person reads on a node —
 * the action's title in English, German and French, the connector's display
 * name and its icon. Read from the shipped catalog, not a stub, so the answer
 * is the one a deployment gives.
 */

const io = vi.hoisted(() => ({ role: 'developer' }));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { id: 'u1' } } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (original) => ({
  ...(await original<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: io.role } as never);
      await next();
    },
}));

import { createAutomationRoutes } from './routes.ts';

async function getCatalog() {
  const app = new Hono().route(
    '/api/app/automations',
    createAutomationRoutes({ sql: {} as never, auth: {} as never }),
  );
  return app.request('/api/app/automations/catalog/node-types');
}

beforeEach(() => {
  io.role = 'developer';
});

describe('GET /catalog/node-types', () => {
  it('refuses a member: the catalog serves the people who author automations', async () => {
    io.role = 'member';
    expect((await getCatalog()).status).toBe(403);
  });

  it('answers each action with its connector and its title in every shipped language', async () => {
    const response = await getCatalog();
    expect(response.status).toBe(200);
    // The answer is the shape the app parses: the server and the client
    // read one schema.
    const catalog = nodeTypeCatalogSchema.parse(await response.json());

    const listIssues = catalog.nodeTypes.find(
      (row) => row.type === 'github.list_issues',
    );
    expect(listIssues).toMatchObject({
      kind: 'connector',
      connector: 'github',
      title: 'List issues',
      i18n: {
        de: { title: 'Issues auflisten' },
        fr: { title: 'Lister les issues' },
      },
      hasEffect: false,
    });
    expect(
      catalog.nodeTypes.find((row) => row.type === 'github.create_issue')
        ?.hasEffect,
    ).toBe(true);

    for (const row of catalog.nodeTypes) {
      expect(row.kind, row.type).toBe('connector');
      expect(row.type.startsWith(`${row.connector}.`), row.type).toBe(true);
      expect(row.title, row.type).toBeTruthy();
      expect(row.i18n?.de?.title, row.type).toBeTruthy();
      expect(row.i18n?.fr?.title, row.type).toBeTruthy();
    }
    const types = catalog.nodeTypes.map((row) => row.type);
    expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
  });

  it('names every connector once, with its display name, translations and icon', async () => {
    const catalog = nodeTypeCatalogSchema.parse(
      await (await getCatalog()).json(),
    );
    const names = catalog.connectors.map((connector) => connector.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // Every row's connector is among them, so a face never misses its name.
    for (const row of catalog.nodeTypes) {
      expect(names, row.type).toContain(row.connector);
    }

    const github = catalog.connectors.find((c) => c.name === 'github');
    expect(github?.displayName).toBe('GitHub');
    // A brand keeps its name in every language.
    expect(github?.i18n).toBeUndefined();
    // The shipped icon, inline: no extra request, no static route.
    expect(github?.iconUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(
      github?.iconUrl?.split(',')[1] ?? '',
      'base64',
    ).toString('utf8');
    expect(svg).toContain('<svg');

    const tasks = catalog.connectors.find((c) => c.name === 'task');
    expect(tasks).toMatchObject({
      displayName: 'Tasks',
      i18n: {
        de: { displayName: 'Aufgaben' },
        fr: { displayName: 'Tâches' },
      },
    });
    // A connector that ships no icon answers without one; the face falls
    // back to its own glyph.
    const conversations = catalog.connectors.find(
      (c) => c.name === 'conversation',
    );
    expect(conversations).toBeDefined();
    expect(conversations?.iconUrl).toBeUndefined();
  });
});
