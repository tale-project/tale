// @vitest-environment node

/**
 * The pg store's `orgFacts` — what the validator's org-state warnings read:
 * as the actor (their role decides whether secret names are a fact; the
 * machine doors count only the installations the actor can read), for the
 * store's own organization, and never longer than its budget — a slow read
 * is "cannot tell", never a held save.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgFactsQuery } from '../../../lib/engine/core/slots.ts';
import { listProjects, type ProjectListRow } from '../projects/service.ts';

const { readOrgFacts } = vi.hoisted(() => ({ readOrgFacts: vi.fn() }));
vi.mock('./org-facts.ts', () => ({ readOrgFacts }));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  listProjects: vi.fn(),
}));

import { ORG_FACTS_BUDGET_MS, pgAutomationStore } from './dispatch-store.ts';

const QUERY: OrgFactsQuery = {
  automation: 'support/reply',
  skills: true,
  connectors: false,
  secrets: true,
  harnesses: false,
  event: false,
};

function sqlAs(role: string): Sql {
  const tag = async (strings: TemplateStringsArray) =>
    strings.join('?').includes('FROM "member"') ? [{ role }] : [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reads the viewer makes
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjects).mockResolvedValue([
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the field the viewer reads
    { id: 'proj_sales' } as unknown as ProjectListRow,
  ]);
});

describe('pgAutomationStore.orgFacts', () => {
  it('reads the facts as the actor, in the store’s organization, with the installations they can read [MCP-R15]', async () => {
    readOrgFacts.mockImplementation(
      async (
        _sql: Sql,
        _org: string,
        _query: OrgFactsQuery,
        viewer: () => Promise<unknown>,
      ) => ({ viewer: await viewer() }),
    );
    const store = pgAutomationStore(sqlAs('member'), {
      organizationId: 'org_acme',
      actor: 'api-key:user_mia',
      visibleOnly: true,
    });
    const facts = await store.orgFacts?.(QUERY);
    expect(readOrgFacts).toHaveBeenCalledWith(
      expect.anything(),
      'org_acme',
      QUERY,
      expect.any(Function),
    );
    expect(facts).toEqual({
      viewer: { role: 'member', readable: new Set(['proj_sales']) },
    });
  });

  it('counts every installation for the app’s own editor', async () => {
    readOrgFacts.mockImplementation(
      async (
        _sql: Sql,
        _org: string,
        _query: OrgFactsQuery,
        viewer: () => Promise<unknown>,
      ) => ({ viewer: await viewer() }),
    );
    const store = pgAutomationStore(sqlAs('developer'), {
      organizationId: 'org_acme',
      actor: 'user_noah',
    });
    expect(await store.orgFacts?.(QUERY)).toEqual({
      viewer: { role: 'developer', readable: null },
    });
  });

  it('cannot tell once the reads outlast their budget, without waiting for them', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      readOrgFacts.mockReturnValue(new Promise(() => {}));
      const store = pgAutomationStore(sqlAs('admin'), {
        organizationId: 'org_acme',
        actor: 'user_ada',
      });
      const answer = store.orgFacts?.(QUERY);
      await vi.advanceTimersByTimeAsync(ORG_FACTS_BUDGET_MS);
      await expect(answer).resolves.toEqual({});
      expect(warn).toHaveBeenCalledWith(
        `[automations] organization facts not answered within ${ORG_FACTS_BUDGET_MS} ms; cannot tell`,
      );
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
