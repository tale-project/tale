/**
 * The machine door's automation-binding step, full-DB: the internal mutation
 * behind `POST /api/v1/automations/{name}/projects` adds exactly one binding
 * row idempotently (single-row add, never a whole-set reconcile), re-runs the
 * developer gate with the explicit user, refuses ghost automations, and
 * collapses cross-org / invisible projects into the same opaque refusal.
 * Handler-level delegation is pinned in `rest_api.test.ts`.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { automationStore } from './store';

const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_rest_bind';
const OTHER_ORG = 'org_rest_bind_b';
const DEV = 'u_bind_dev';
const EDITOR = 'u_bind_editor';

type T = TestConvex<typeof schema>;

function makeT(): T {
  return convexTest(schema, modules);
}

async function seedMember(t: T, userId: string, role: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `ba_${userId}`,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
  });
}

async function seedProject(
  t: T,
  organizationId: string,
): Promise<Id<'projects'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('projects', {
      organizationId,
      name: 'Client ledgers',
      createdBy: DEV,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

async function seedAutomation(t: T, name: string): Promise<void> {
  await t.run(async (ctx) => {
    const store = automationStore(ctx, { organizationId: ORG, actor: DEV });
    await store.save({ version: 1 as const, name, nodes: [] });
  });
}

function bind(
  t: T,
  overrides: Partial<{
    organizationId: string;
    userId: string;
    name: string;
    projectId: string;
  }> & { projectId: string },
): Promise<{ added: boolean }> {
  return t.mutation(internal.automations.rest_api.restBindAutomationProject, {
    organizationId: ORG,
    userId: DEV,
    name: 'desk/vat-return',
    ...overrides,
  });
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String(data.code)
    : undefined;
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const error = await p.then(
    () => {
      throw new Error(`expected a rejection with code ${code}`);
    },
    (err: unknown) => err,
  );
  expect(codeOf(error)).toBe(code);
}

describe('restBindAutomationProject', () => {
  it('adds one binding row idempotently, attributed to the key user', async () => {
    const t = makeT();
    await seedMember(t, DEV, 'developer');
    await seedAutomation(t, 'desk/vat-return');
    const projectId = await seedProject(t, ORG);

    const first = await bind(t, { projectId });
    expect(first).toEqual({ added: true });

    const second = await bind(t, { projectId });
    expect(second).toEqual({ added: false });

    const rows = await t.run((ctx) =>
      ctx.db.query('automationProjectBindings').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: ORG,
      automationName: 'desk/vat-return',
      projectId,
      boundBy: DEV,
    });
  });

  it('refuses a ghost automation — a binding must point at a real one', async () => {
    const t = makeT();
    await seedMember(t, DEV, 'developer');
    const projectId = await seedProject(t, ORG);

    await expectCode(
      bind(t, { name: 'desk/never-saved', projectId }),
      'AUTOMATION_NOT_FOUND',
    );
  });

  it('refuses a role without the developer capability', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, 'editor');
    await seedAutomation(t, 'desk/vat-return');
    const projectId = await seedProject(t, ORG);

    await expectCode(
      bind(t, { userId: EDITOR, projectId }),
      'FORBIDDEN_DEVELOPER_SETTINGS',
    );
  });

  it('collapses a cross-org project into the opaque refusal', async () => {
    const t = makeT();
    await seedMember(t, DEV, 'developer');
    await seedAutomation(t, 'desk/vat-return');
    const foreign = await seedProject(t, OTHER_ORG);

    await expectCode(bind(t, { projectId: foreign }), 'PROJECT_NOT_FOUND');
    expect(
      await t.run((ctx) => ctx.db.query('automationProjectBindings').collect()),
    ).toEqual([]);
  });

  it('refuses an invalid automation name as a plain bad request', async () => {
    const t = makeT();
    await seedMember(t, DEV, 'developer');
    const projectId = await seedProject(t, ORG);

    await expectCode(
      bind(t, { name: 'NOT A SLUG!!', projectId }),
      'INVALID_ARGUMENTS',
    );
  });
});
