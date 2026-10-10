// @vitest-environment node

/**
 * Unit lock for the two admission verbs, `reserveSessionSlot` (a fresh
 * session) and `resumeSessionSlot` (a stopped workspace coming back): each
 * workload is counted against its own limit, a session at the limit is
 * refused with `QUOTA_EXCEEDED` before anything is written, and a workspace
 * whose Destroy is pending admits nothing, marked `destroy_pending` so no
 * lane reads it as a full limit. The SQL is scripted; the real-Postgres
 * probe (`lifecycle.integration.ts`) proves the same verbs on the schema,
 * racing admissions included.
 */

import { DEFAULT_SANDBOX_QUOTA } from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  projectSessionRoom,
  reserveSessionSlot,
  resumeSessionSlot,
} from './sessions.ts';

const { policy } = vi.hoisted(() => ({ policy: vi.fn() }));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: policy,
}));
vi.mock('../tasks/agent-runs.ts', () => ({
  wakeParkedAgentRuns: vi.fn(() => Promise.resolve(0)),
}));
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(() => Promise.resolve()),
}));
vi.mock('./idle-release.ts', () => ({
  captureIdleReleaseTickets: vi.fn(async () => new Map()),
  enqueueIdleSessionReleases: vi.fn(async () => undefined),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const PENDING_DESTROY = 'AS pending';
const OWNER_COUNT = 'SELECT count(*)::text AS count';
const IN_FLIGHT = 'SELECT owner_type AS "ownerType" FROM app.sandbox_sessions';
const INSERT = 'INSERT INTO app.sandbox_sessions';
const RESUMED_ROW = 'SELECT id, status, owner_type AS "ownerType", pinned';
const RESUME = "UPDATE app.sandbox_sessions SET status = 'active'";

/**
 * A scripted `sql`: every statement is recorded and answered with the rows
 * of the first matcher its text contains. `inFlight` is the owner type of
 * every session of the organization that is starting or working.
 */
function fakeSql(script: {
  inFlight?: string[];
  destroyPending?: boolean;
  resumed?: { status: string; ownerType: string; pinned: boolean };
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const answers: Array<{ match: string; rows: unknown[] }> = [
    {
      match: PENDING_DESTROY,
      rows: [{ pending: script.destroyPending ?? false }],
    },
    { match: OWNER_COUNT, rows: [{ count: '0' }] },
    {
      match: IN_FLIGHT,
      rows: (script.inFlight ?? []).map((ownerType) => ({ ownerType })),
    },
    { match: INSERT, rows: [{ id: 'row-new' }] },
    {
      match: RESUMED_ROW,
      rows:
        script.resumed === undefined
          ? []
          : [{ id: 'row-1', ...script.resumed }],
    },
    { match: RESUME, rows: [{ id: 'row-1' }] },
  ];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find((answer) => text.includes(answer.match));
    return Promise.resolve(hit?.rows ?? []);
  };
  const sql = Object.assign(run, {
    json: (value: unknown) => value,
    begin: (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const ran = (statements: Statement[], match: string): boolean =>
  statements.some((statement) => statement.text.includes(match));

const AGENT_SESSION = {
  organizationId: 'org-1',
  sessionId: 'pa-agent-1',
  profile: 'agent',
  ownerType: 'project_agent',
  ownerId: 'agent-1',
  createdBy: 'system:task-agent',
};

beforeEach(() => {
  vi.clearAllMocks();
  // No saved policy: the organization runs on the defaults.
  policy.mockResolvedValue(null);
});

describe('reserveSessionSlot — each workload against its own limit [SBX-R8]', () => {
  it('uses a limit of 2 for each workload when the organization set none', () => {
    expect(DEFAULT_SANDBOX_QUOTA).toEqual({
      maxSessionsPerOrg: 2,
      maxWorkflowSessionsPerOrg: 2,
      maxRenderSessionsPerOrg: 2,
    });
  });

  it('admits a session while its workload is under its limit', async () => {
    const { sql, statements } = fakeSql({ inFlight: ['project_agent'] });

    await expect(reserveSessionSlot(sql, AGENT_SESSION)).resolves.toBe(
      'row-new',
    );

    expect(policy).toHaveBeenCalledWith(sql, 'org-1', 'sandbox_quota');
    expect(ran(statements, INSERT)).toBe(true);
  });

  it('refuses the next session at the limit with QUOTA_EXCEEDED and reserves nothing', async () => {
    const { sql, statements } = fakeSql({
      inFlight: ['project_agent', 'project_agent'],
    });

    await expect(reserveSessionSlot(sql, AGENT_SESSION)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      reason: undefined,
      message:
        'At most 2 project sandbox sessions can be active for this organization.',
    });

    expect(ran(statements, INSERT)).toBe(false);
  });

  it('counts only sessions that are starting or working, never a stopped workspace', async () => {
    const { sql, statements } = fakeSql({});

    await reserveSessionSlot(sql, AGENT_SESSION);

    const count = statements.find((statement) =>
      statement.text.includes(IN_FLIGHT),
    );
    expect(count?.text).toContain(
      "WHERE org_id = ? AND status IN ('creating', 'active')",
    );
    expect(count?.values).toEqual(['org-1']);
  });

  it('leaves the other workloads out of the count', async () => {
    // Both workflow slots and both render slots are taken; the project
    // agents' own limit is untouched.
    const { sql, statements } = fakeSql({
      inFlight: ['workflow_run', 'workflow_run', 'render', 'render'],
    });

    await expect(reserveSessionSlot(sql, AGENT_SESSION)).resolves.toBe(
      'row-new',
    );
    expect(ran(statements, INSERT)).toBe(true);

    const full = fakeSql({
      inFlight: ['workflow_run', 'workflow_run', 'render', 'render'],
    });
    await expect(
      reserveSessionSlot(full.sql, {
        ...AGENT_SESSION,
        sessionId: 'wf-run-1',
        ownerType: 'workflow_run',
        ownerId: 'run-1:@workflow',
      }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      message:
        'At most 2 workflow sandbox sessions can be active for this organization.',
    });
    expect(ran(full.statements, INSERT)).toBe(false);
  });

  it('follows the limit the organization set', async () => {
    policy.mockResolvedValue({
      maxSessionsPerOrg: 1,
      maxWorkflowSessionsPerOrg: 2,
      maxRenderSessionsPerOrg: 2,
    });
    const { sql, statements } = fakeSql({ inFlight: ['project_agent'] });

    await expect(reserveSessionSlot(sql, AGENT_SESSION)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    expect(ran(statements, INSERT)).toBe(false);
  });
});

describe('every agent worker holds a slot of its own [SBX-R18]', () => {
  const SECOND_WORKER = { ...AGENT_SESSION, sessionId: 'pa-agent-1-w2' };

  it("admits an agent's second worker beside its first while a slot is left", async () => {
    const { sql, statements } = fakeSql({ inFlight: ['project_agent'] });

    await expect(reserveSessionSlot(sql, SECOND_WORKER)).resolves.toBe(
      'row-new',
    );

    // The one-live-session cap is the worker's own, never the agent's.
    const owner = statements.find((statement) =>
      statement.text.includes(OWNER_COUNT),
    );
    expect(owner?.values).toContain('pa-agent-1-w2');
  });

  it("refuses an agent's third worker when its two hold both slots", async () => {
    const { sql, statements } = fakeSql({
      inFlight: ['project_agent', 'project_agent'],
    });

    await expect(
      reserveSessionSlot(sql, {
        ...AGENT_SESSION,
        sessionId: 'pa-agent-1-w3',
      }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', reason: undefined });
    expect(ran(statements, INSERT)).toBe(false);
  });

  it('reads the cap and the workers holding a slot for a claim', async () => {
    const { sql } = fakeSql({ inFlight: ['project_agent', 'workflow_run'] });

    await expect(
      sql.begin((tx) => projectSessionRoom(tx, 'org-1')),
    ).resolves.toEqual({ cap: 2, inFlight: 1 });
  });
});

describe('resumeSessionSlot — a stopped workspace coming back [SBX-R8]', () => {
  const ARGS = { organizationId: 'org-1', sessionId: 'pa-agent-1' };
  const STOPPED = {
    status: 'stopped',
    ownerType: 'project_agent',
    pinned: false,
  };

  it('takes a slot again while its workload is under its limit', async () => {
    const { sql, statements } = fakeSql({
      resumed: STOPPED,
      inFlight: ['project_agent'],
    });

    await expect(resumeSessionSlot(sql, ARGS)).resolves.toBe(true);

    expect(ran(statements, RESUME)).toBe(true);
  });

  it('is refused at the limit with QUOTA_EXCEEDED and stays stopped', async () => {
    const { sql, statements } = fakeSql({
      resumed: STOPPED,
      inFlight: ['project_agent', 'project_agent'],
    });

    await expect(resumeSessionSlot(sql, ARGS)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      reason: undefined,
    });

    expect(ran(statements, RESUME)).toBe(false);
  });
});

describe('a workspace whose Destroy is pending admits nothing [SBX-R9]', () => {
  const MESSAGE =
    'An administrator is deleting this sandbox workspace. No new work starts in it until the deletion has finished.';

  it('refuses a fresh session under its id, marked destroy_pending, and reserves nothing', async () => {
    const { sql, statements } = fakeSql({ destroyPending: true });

    await expect(reserveSessionSlot(sql, AGENT_SESSION)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      reason: 'destroy_pending',
      message: MESSAGE,
    });

    // Refused before the limit is even read: this is no want of room.
    expect(ran(statements, IN_FLIGHT)).toBe(false);
    expect(ran(statements, INSERT)).toBe(false);
  });

  it('refuses to resume it, and leaves the row as it was', async () => {
    const { sql, statements } = fakeSql({
      destroyPending: true,
      resumed: { status: 'stopped', ownerType: 'project_agent', pinned: false },
    });

    await expect(
      resumeSessionSlot(sql, {
        organizationId: 'org-1',
        sessionId: 'pa-agent-1',
      }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      reason: 'destroy_pending',
      message: MESSAGE,
    });

    expect(ran(statements, RESUME)).toBe(false);
  });
});
