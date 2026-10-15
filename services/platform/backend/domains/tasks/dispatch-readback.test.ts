import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  countRunsByAgent,
  dispatchAsReadBy,
  idleReason,
  nameIfReadable,
  readDispatchAsReader,
} from './dispatch-readback.ts';

describe('the readback says why an idle agent of the pool is idle [TASK-R46]', () => {
  it('names a switched-off dispatch first, then the model the agent waits on', () => {
    expect(
      idleReason({ enabled: false, heldUntil: 5, lastStopReason: 'started' }),
    ).toBe('disabled');
    expect(
      idleReason({ enabled: true, heldUntil: 5, lastStopReason: 'started' }),
    ).toBe('model_capacity');
  });

  it('otherwise reads the last pass: a held host, full agent workers, a paced start, nothing ready', () => {
    const reasonAfter = (lastStopReason: string | null) =>
      idleReason({ enabled: true, heldUntil: null, lastStopReason });
    expect(reasonAfter('host_pressure')).toBe('host_pressure');
    expect(reasonAfter('org_limit')).toBe('org_limit');
    expect(reasonAfter('pacing')).toBe('pacing');
    expect(reasonAfter('automation_disabled')).toBe('disabled');
    expect(reasonAfter('no_ready_work')).toBe('no_ready_work');
    expect(reasonAfter('agents_busy')).toBe('no_ready_work');
    expect(reasonAfter(null)).toBe('unknown');
  });

  it('reads a pass that waits for the next start as waiting between starts: a ramping model, a pass out of time', () => {
    const reasonAfter = (lastStopReason: string) =>
      idleReason({ enabled: true, heldUntil: null, lastStopReason });
    expect(reasonAfter('model_ramp')).toBe('pacing');
    expect(reasonAfter('budget')).toBe('pacing');
  });
});

describe('the readback counts the runs an agent of the pool holds, by what they do [TASK-R46]', () => {
  it('counts running, queued and waiting runs, the waiting ones by why', () => {
    const counts = countRunsByAgent([
      {
        agentId: 'coder',
        projectId: 'p-dev',
        status: 'running',
        parked: false,
        reason: null,
        count: 244,
      },
      {
        agentId: 'coder',
        projectId: 'p-dev',
        status: 'queued',
        parked: false,
        reason: null,
        count: 4,
      },
      {
        agentId: 'coder',
        projectId: 'p-dev',
        status: 'queued',
        parked: true,
        reason: 'model_capacity',
        count: 6,
      },
      {
        agentId: 'coder',
        projectId: 'p-dev',
        status: 'queued',
        parked: true,
        reason: 'org_limit',
        count: 2,
      },
      {
        agentId: 'scribe',
        projectId: 'p-dev',
        status: 'running',
        parked: false,
        reason: null,
        count: 1,
      },
    ]);
    expect(counts.get('coder')).toEqual({
      total: 256,
      running: 244,
      queued: 4,
      waiting: { model_capacity: 6, org_limit: 2 },
    });
    expect(counts.get('scribe')).toEqual({
      total: 1,
      running: 1,
      queued: 0,
      waiting: {},
    });
    expect(counts.has('lector')).toBe(false);
  });

  it('counts a wait this version cannot name as unknown, as the listed run reads it', () => {
    const counts = countRunsByAgent([
      {
        agentId: 'coder',
        projectId: 'p-dev',
        status: 'queued',
        parked: true,
        reason: 'a_newer_reason',
        count: 3,
      },
      {
        agentId: 'coder',
        projectId: 'p-dev',
        status: 'queued',
        parked: true,
        reason: null,
        count: 2,
      },
    ]);
    expect(counts.get('coder')?.waiting).toEqual({ unknown: 5 });
  });
});

describe('the readback names another project only to who may read it [TASK-R80]', () => {
  it('keeps the name of a project the reader may read, and withholds the rest', () => {
    const readable = new Set(['p-dev', 'p-billing']);
    expect(nameIfReadable(readable, 'p-billing', 'Billing')).toBe('Billing');
    expect(nameIfReadable(readable, 'p-payroll', 'Payroll')).toBeNull();
    // A project gone from the organization has no name to withhold.
    expect(nameIfReadable(readable, 'p-dev', null)).toBeNull();
  });
});

describe('the readback shows the labels of a board it serves only to who may read it [TASK-R80]', () => {
  /** Development's dispatch serves Billing and Payroll; its deploy gate
   * names Development's label "release", Billing's "invoices" and
   * Payroll's "salaries"; its payroll gate names Payroll's alone. */
  const config: ProjectDispatch = {
    enabled: true,
    agents: ['coder'],
    maxConcurrentRuns: 2,
    statuses: ['todo'],
    assignment: 'pool',
    labels: { include: ['release'] },
    sources: [
      { projectId: 'p-billing', labels: { include: ['Invoices'] } },
      {
        projectId: 'p-payroll',
        labels: { include: ['Salaries'], exclude: ['Secret'] },
      },
    ],
    gates: [
      { key: 'deploy', labels: ['release', 'Invoices', 'Salaries'] },
      { key: 'payroll', labels: ['Salaries'] },
      { key: 'freeze' },
    ],
  };

  it('withholds a hidden board’s labels, and the gate labels only it has, from who may not read it', () => {
    // Noah reads Development and Billing, not Payroll.
    expect(
      dispatchAsReadBy(
        config,
        new Set(['p-dev', 'p-billing']),
        new Set(['release', 'invoices']),
      ),
    ).toEqual({
      ...config,
      sources: [
        { projectId: 'p-billing', labels: { include: ['Invoices'] } },
        { projectId: 'p-payroll' },
      ],
      // A gate left with none of its labels governs only work he may not
      // read: it is left out, not shown as holding every ready task.
      gates: [
        { key: 'deploy', labels: ['release', 'Invoices'] },
        { key: 'freeze' },
      ],
    });
  });

  it('shows the whole dispatch to who reads every board it serves', () => {
    expect(
      dispatchAsReadBy(config, new Set(['p-billing', 'p-payroll']), new Set()),
    ).toBe(config);
  });

  it('reads the labels of the projects the reader reads, and nothing for who administers the dispatch', async () => {
    const queries: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(values);
      expect(strings.join('?')).toContain('FROM app.task_labels');
      return Promise.resolve([{ name: 'release' }, { name: 'invoices' }]);
    }) as unknown as Sql;
    const auth = {
      organizationId: 'org-1',
      userId: 'noah',
      role: 'member',
      teamIds: [],
    };
    const readable = new Set(['p-dev', 'p-billing']);
    const shown = await readDispatchAsReader(sql, auth, {
      projectId: 'p-dev',
      config,
      administers: false,
      readable,
    });
    expect(shown.sources?.[1]).toEqual({ projectId: 'p-payroll' });
    expect(shown.gates?.map((gate) => gate.key)).toEqual(['deploy', 'freeze']);
    // Development's labels and Billing's, never Payroll's.
    expect(queries[0]).toEqual([
      'org-1',
      ['p-dev', 'p-billing'],
      ['release', 'invoices', 'salaries'],
    ]);
    const untouched = vi.fn();
    expect(
      await readDispatchAsReader(untouched as unknown as Sql, auth, {
        projectId: 'p-dev',
        config,
        administers: true,
        readable,
      }),
    ).toBe(config);
    expect(untouched).not.toHaveBeenCalled();
  });
});
