// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { appOrigin, mcpOrigin } from '../../lib/write-origin.ts';
import {
  listDeploymentEvents,
  recentDeployments,
  recordDeploymentInTx,
  type DeploymentPointer,
} from './deployments.ts';

interface Statement {
  text: string;
  values: unknown[];
}

interface EventRecord {
  id: string;
  version: number;
  previousVersion: number | null;
  kind: string;
  actor: string;
  via: string | null;
  apiKeyId: string | null;
  client: string | null;
  atMs: number;
}

/** A SQL double that answers the pointer, the events (newest first, as
 * given) and the count of active runs, and records every statement. */
function fake(state: {
  pointer?: { version: number; deployedBy: string; deployedAtMs: number };
  events?: EventRecord[];
  activeRuns?: number;
}) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    // An optional clause composed into a statement, not a statement.
    if (text === '' || text.startsWith('AND (')) return { fragment: text };
    statements.push({ text, values });
    if (text.includes('FROM app.automation_deployments')) {
      return Promise.resolve(
        state.pointer === undefined ? [] : [state.pointer],
      );
    }
    if (text.startsWith('INSERT INTO app.automation_deployment_events')) {
      return Promise.resolve(
        text.includes('RETURNING id') ? [{ id: 'event-new' }] : [],
      );
    }
    if (text.includes('FROM app.automation_deployment_events')) {
      // The newest event is one row; a page names its size last.
      const limit = text.endsWith('LIMIT 1') ? 1 : Number(values.at(-1));
      return Promise.resolve((state.events ?? []).slice(0, limit));
    }
    if (text.includes('count(*)')) {
      return Promise.resolve([{ count: state.activeRuns ?? 0 }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql & TransactionSql, statements };
}

const inserts = (statements: Statement[]) =>
  statements.filter((s) =>
    s.text.startsWith('INSERT INTO app.automation_deployment_events'),
  );

const ORG = 'org_1';
const NAME = 'billing/dunning';

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: 'event-1',
    version: 6,
    previousVersion: 5,
    kind: 'deploy',
    actor: 'user_ada',
    via: 'app',
    apiKeyId: null,
    client: null,
    atMs: 2_000,
    ...overrides,
  };
}

describe('recordDeploymentInTx [AUTO-R46]', () => {
  it('records the first deploy with who, the door, the key and the client', async () => {
    const { sql, statements } = fake({});
    const answer = await recordDeploymentInTx(sql, {
      organizationId: ORG,
      name: NAME,
      version: 1,
      pointer: null,
      origin: mcpOrigin({
        userId: 'user_ada',
        apiKeyId: 'key_1',
        clientName: 'Claude Code',
      }),
      atMs: 1_000,
    });
    expect(answer).toEqual({ id: 'event-new', kind: 'deploy' });
    const [insert, ...more] = inserts(statements);
    expect(more).toEqual([]);
    expect(insert?.values).toEqual([
      ORG,
      NAME,
      1,
      null,
      'deploy',
      'api-key:user_ada',
      'mcp',
      'key_1',
      'Claude Code',
      1_000,
    ]);
  });

  it('records an older version put back as a rollback, over the live one the history already says', async () => {
    const pointer: DeploymentPointer = {
      version: 7,
      deployedBy: 'user_ben',
      deployedAtMs: 3_000,
    };
    const { sql, statements } = fake({
      events: [event({ id: 'event-7', version: 7, atMs: 3_000 })],
    });
    const answer = await recordDeploymentInTx(sql, {
      organizationId: ORG,
      name: NAME,
      version: 6,
      pointer,
      origin: appOrigin('user_ada'),
      atMs: 4_000,
    });
    expect(answer.kind).toBe('rollback');
    const all = inserts(statements);
    expect(all).toHaveLength(1);
    expect(all[0]?.values.slice(2, 7)).toEqual([
      6,
      7,
      'rollback',
      'user_ada',
      'app',
    ]);
  });

  it('records a live version no event says — a previous image put it live — before its own', async () => {
    // v6 is the newest event, but the pointer says v7 since 3 000: the
    // previous image deployed it during a rolling deploy.
    const { sql, statements } = fake({
      events: [event({ version: 6, atMs: 2_000 })],
    });
    await recordDeploymentInTx(sql, {
      organizationId: ORG,
      name: NAME,
      version: 8,
      pointer: { version: 7, deployedBy: 'user_ben', deployedAtMs: 3_000 },
      origin: appOrigin('user_ada'),
      atMs: 4_000,
    });
    const [recorded, deployed] = inserts(statements);
    expect(recorded?.text).toContain("NULL, 'recorded'");
    expect(recorded?.values).toEqual([ORG, NAME, 7, 'user_ben', null, 3_000]);
    expect(deployed?.values.slice(2, 5)).toEqual([8, 7, 'deploy']);
  });

  it('keeps each event later than the one before, even within one millisecond', async () => {
    // v7 went live at 5 000, and the rollback lands in the same millisecond.
    const { sql, statements } = fake({
      events: [event({ id: 'event-7', version: 7, atMs: 5_000 })],
    });
    await recordDeploymentInTx(sql, {
      organizationId: ORG,
      name: NAME,
      version: 6,
      pointer: { version: 7, deployedBy: 'user_ben', deployedAtMs: 5_000 },
      origin: appOrigin('user_ada'),
      atMs: 5_000,
    });
    const [only, ...more] = inserts(statements);
    expect(more).toEqual([]);
    expect(only?.values.at(-1)).toBe(5_001);
  });

  it('records the platform’s own pointer with its door', async () => {
    const { sql, statements } = fake({});
    await recordDeploymentInTx(sql, {
      organizationId: ORG,
      name: NAME,
      version: 2,
      pointer: {
        version: 1,
        deployedBy: 'system:provisioning',
        deployedAtMs: 500,
      },
      origin: appOrigin('user_ada'),
      atMs: 4_000,
    });
    expect(inserts(statements)[0]?.values).toEqual([
      ORG,
      NAME,
      1,
      'system:provisioning',
      'system',
      500,
    ]);
  });
});

describe('listDeploymentEvents [AUTO-R46]', () => {
  it('answers what is live, its running runs, and the events newest first, scoped to the automation', async () => {
    const { sql, statements } = fake({
      pointer: { version: 7, deployedBy: 'user_ben', deployedAtMs: 3_000 },
      events: [
        event({
          id: 'event-7',
          version: 7,
          previousVersion: 6,
          actor: 'user_ben',
          via: 'mcp',
          client: 'Claude Code',
          atMs: 3_000,
        }),
        event({ id: 'event-6', version: 6, previousVersion: null }),
      ],
      activeRuns: 2,
    });
    const history = await listDeploymentEvents(sql, ORG, NAME);
    expect(history.live).toEqual({
      version: 7,
      since: 3_000,
      actor: 'user_ben',
      via: 'mcp',
      clientName: 'Claude Code',
      activeRuns: 2,
    });
    expect(history.events.map((row) => [row.id, row.kind])).toEqual([
      ['event-7', 'deploy'],
      ['event-6', 'deploy'],
    ]);
    expect(history.nextBefore).toBeNull();
    for (const statement of statements) {
      expect(statement.values).toEqual(expect.arrayContaining([ORG, NAME]));
    }
  });

  it('pages by time and id, and says where the next page starts', async () => {
    const { sql } = fake({
      events: [
        event({ id: 'c', atMs: 30 }),
        event({ id: 'b', atMs: 20 }),
        event({ id: 'a', atMs: 10 }),
      ],
    });
    const page = await listDeploymentEvents(sql, ORG, NAME, { limit: 2 });
    expect(page.events.map((row) => row.id)).toEqual(['c', 'b']);
    expect(page.nextBefore).toEqual({ at: 20, id: 'b' });
  });

  it('leads with a live version no event says yet, built from the pointer', async () => {
    const { sql } = fake({
      pointer: { version: 7, deployedBy: 'user_ben', deployedAtMs: 3_000 },
      events: [event({ version: 6, atMs: 2_000 })],
    });
    const history = await listDeploymentEvents(sql, ORG, NAME);
    expect(history.events[0]).toMatchObject({
      version: 7,
      kind: 'recorded',
      synthesized: true,
      actor: 'user_ben',
      via: null,
      at: 3_000,
    });
    expect(history.events).toHaveLength(2);
    // Who put it live is known; the door is not.
    expect(history.live).toMatchObject({ version: 7, via: null });
  });

  it('answers nothing live and no events for an automation never deployed', async () => {
    const { sql } = fake({});
    expect(await listDeploymentEvents(sql, ORG, NAME)).toEqual({
      live: null,
      events: [],
      nextBefore: null,
    });
  });
});

describe('recentDeployments', () => {
  it('answers the deploys list_versions shows, the person by user id', async () => {
    const { sql } = fake({
      pointer: {
        version: 7,
        deployedBy: 'api-key:user_ada',
        deployedAtMs: 3_000,
      },
      events: [
        event({
          id: 'event-7',
          version: 7,
          actor: 'api-key:user_ada',
          via: 'mcp',
          atMs: 3_000,
        }),
      ],
    });
    expect(await recentDeployments(sql, ORG, NAME)).toEqual([
      {
        version: 7,
        previousVersion: 5,
        deployedAt: 3_000,
        deployedBy: 'user_ada',
        via: 'mcp',
      },
    ]);
  });
});
