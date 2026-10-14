import {
  projectDispatchSchema,
  type ProjectDispatch,
} from '@tale/shared/schemas/project-dispatch';
import { describe, expect, it } from 'vitest';

import {
  dispatchFormSchema,
  type DispatchFormText,
  type DispatchFormValues,
  dispatchIssuesOf,
  emptyGate,
  emptyRole,
  parseRecheck,
  placeIssue,
  toDispatch,
  toFormValues,
} from './dispatch-form';

const TEXT: DispatchFormText = {
  maxConcurrentRuns: 'runs',
  perAgentConcurrency: 'per agent',
  startSpacing: 'spacing',
  recheck: 'recheck',
  agentsMax: 'agents max',
  labelsMax: 'labels max',
  key: 'key',
  keyTaken: 'key taken',
  roleAgent: 'role agent',
  roleTask: 'role task',
  cronRequired: 'cron required',
  cronInvalid: (reason) => `cron invalid: ${reason}`,
  timezone: 'zone',
  mode: 'mode',
  brief: 'brief',
  number: 'number',
  recoverWithoutHold: 'recover without hold',
  recoverAboveHold: 'recover above hold',
  staleAfter: 'stale after',
  gateSpacing: 'gate spacing',
};

/** A dispatch that declares only what it must, as managed configuration
 * often does: every reader defaults the rest. */
const SPARSE: ProjectDispatch = {
  enabled: true,
  agents: ['agent-scribe', 'agent-lector'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'assigned',
};

/** A dispatch that declares everything, standing roles and gates too. */
const FULL: ProjectDispatch = {
  enabled: false,
  agents: ['agent-scribe'],
  maxConcurrentRuns: 4,
  perAgentConcurrency: 2,
  statuses: ['backlog', 'todo'],
  assignment: 'pool',
  rebalance: true,
  labels: { include: ['release'], exclude: ['blocked'] },
  admission: {
    preset: 'conservative',
    startSpacingSeconds: 45,
    recheckSeconds: [30, 90],
  },
  standingRoles: [
    {
      key: 'manager',
      taskId: 'task-routing',
      agentId: 'agent-scribe',
      cron: '*/30 * * * *',
      timezone: 'Europe/Zurich',
      mode: 'full',
      brief: 'Route the reviews first.',
    },
  ],
  gates: [
    {
      key: 'ci',
      labels: ['ci'],
      holdAt: 20,
      recoverBelow: 8,
      staleAfterSeconds: 900,
      whenStale: 'hold',
      startSpacingSeconds: 120,
    },
  ],
};

function values(dispatch: ProjectDispatch | null): DispatchFormValues {
  return toFormValues(dispatch, { workersLimit: 3 });
}

describe('the Dispatch editor form', () => {
  it('starts a new dispatch switched on, with an empty pool that may hold as many runs as there are agent workers', () => {
    expect(values(null)).toEqual({
      enabled: true,
      agents: [],
      maxConcurrentRuns: '3',
      perAgentConcurrency: '1',
      statuses: 'todo',
      assignment: 'assigned',
      rebalance: false,
      labels: { include: [], exclude: [] },
      admission: {
        preset: 'default',
        startSpacingSeconds: '30',
        recheckSeconds: '60, 120, 240',
      },
      standingRoles: [],
      gates: [],
    });
    // An organization without workers still starts from one run at once.
    expect(toFormValues(null, { workersLimit: 0 }).maxConcurrentRuns).toBe('1');
    expect(toFormValues(null, { workersLimit: 400 }).maxConcurrentRuns).toBe(
      '100',
    );
  });

  it('saves a new dispatch with only the fields it must declare', () => {
    const draft = values(null);
    draft.agents = ['agent-scribe'];
    const dispatch = toDispatch(draft, null);
    expect(dispatch).toEqual({
      enabled: true,
      agents: ['agent-scribe'],
      maxConcurrentRuns: 3,
      statuses: ['todo'],
      assignment: 'assigned',
    });
    expect(projectDispatchSchema.safeParse(dispatch).success).toBe(true);
  });

  it('saves a dispatch nobody changed exactly as it was stored, what it left out included', () => {
    expect(toDispatch(values(SPARSE), SPARSE)).toEqual(SPARSE);
    expect(toDispatch(values(FULL), FULL)).toEqual(FULL);
  });

  it('writes a field the stored dispatch left out only once it differs from what readers assume', () => {
    const draft = values(SPARSE);
    draft.perAgentConcurrency = '2';
    draft.admission.recheckSeconds = '60 120 240';
    draft.gates = [{ ...emptyGate(), key: 'deploy' }];
    expect(toDispatch(draft, SPARSE)).toEqual({
      ...SPARSE,
      perAgentConcurrency: 2,
      gates: [{ key: 'deploy' }],
    });
  });

  it('keeps a field the stored dispatch declared, even at its default', () => {
    const stored: ProjectDispatch = {
      ...SPARSE,
      perAgentConcurrency: 2,
      rebalance: true,
    };
    const draft = values(stored);
    draft.perAgentConcurrency = '1';
    draft.rebalance = false;
    expect(toDispatch(draft, stored)).toEqual({
      ...SPARSE,
      perAgentConcurrency: 1,
      rebalance: false,
    });
  });

  it('takes ready work from the columns in the order chosen', () => {
    const draft = values(SPARSE);
    draft.statuses = 'backlog,todo';
    expect(toDispatch(draft, SPARSE).statuses).toEqual(['backlog', 'todo']);
    expect(values(FULL).statuses).toBe('backlog,todo');
  });

  it('reads the recheck delays as whole seconds, separated by commas or spaces', () => {
    expect(parseRecheck('60, 120,240')).toEqual([60, 120, 240]);
    expect(parseRecheck('60 120')).toEqual([60, 120]);
    expect(parseRecheck('')).toBeNull();
    expect(parseRecheck('60, soon')).toBeNull();
    expect(parseRecheck('1.5')).toBeNull();
  });

  it('starts a new standing role in the zone it is given and a new gate that opens when nobody reports', () => {
    expect(emptyRole('Europe/Zurich')).toMatchObject({
      key: '',
      timezone: 'Europe/Zurich',
    });
    expect(emptyGate()).toMatchObject({ key: '', whenStale: 'open' });
  });
});

describe('what the Dispatch editor checks before it saves', () => {
  const schema = dispatchFormSchema(TEXT);
  const issuesOf = (draft: DispatchFormValues) => {
    const result = schema.safeParse(draft);
    return result.success
      ? []
      : result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
  };

  it('takes a sound dispatch', () => {
    expect(issuesOf(values(FULL))).toEqual([]);
    expect(issuesOf(values(null))).toEqual([]);
  });

  it('refuses limits out of their range', () => {
    const draft = values(SPARSE);
    draft.maxConcurrentRuns = '0';
    draft.perAgentConcurrency = '6';
    draft.admission.startSpacingSeconds = '';
    draft.admission.recheckSeconds = '5, 60';
    expect(issuesOf(draft)).toEqual([
      { path: 'maxConcurrentRuns', message: 'runs' },
      { path: 'perAgentConcurrency', message: 'per agent' },
      { path: 'admission.startSpacingSeconds', message: 'spacing' },
      { path: 'admission.recheckSeconds', message: 'recheck' },
    ]);
    draft.maxConcurrentRuns = '101';
    draft.perAgentConcurrency = '2.5';
    expect(issuesOf(draft).map((issue) => issue.path)).toContain(
      'maxConcurrentRuns',
    );
    expect(issuesOf(draft).map((issue) => issue.path)).toContain(
      'perAgentConcurrency',
    );
  });

  it('refuses a standing role without its agent, task, schedule or zone', () => {
    const draft = values(SPARSE);
    draft.standingRoles = [
      { ...emptyRole('Mars/Olympus'), key: 'Manager', cron: '61 * * * *' },
      { ...emptyRole('UTC'), key: 'nightly' },
    ];
    const issues = issuesOf(draft);
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: 'standingRoles.0.key', message: 'key' },
        { path: 'standingRoles.0.agentId', message: 'role agent' },
        { path: 'standingRoles.0.taskId', message: 'role task' },
        { path: 'standingRoles.0.timezone', message: 'zone' },
        { path: 'standingRoles.1.cron', message: 'cron required' },
      ]),
    );
    const cron = issues.find((issue) => issue.path === 'standingRoles.0.cron');
    expect(cron?.message).toMatch(/^cron invalid: /);
  });

  it('refuses two standing roles or two gates under one key', () => {
    const draft = values(FULL);
    draft.standingRoles = [
      ...draft.standingRoles,
      { ...draft.standingRoles[0]!, taskId: 'task-other' },
    ];
    draft.gates = [...draft.gates, { ...emptyGate(), key: 'ci' }];
    expect(issuesOf(draft)).toEqual([
      { path: 'standingRoles.1.key', message: 'key taken' },
      { path: 'gates.1.key', message: 'key taken' },
    ]);
  });

  it('refuses a gate that opens again above its hold value, or without one', () => {
    const draft = values(SPARSE);
    draft.gates = [
      { ...emptyGate(), key: 'ci', holdAt: '20', recoverBelow: '25' },
      { ...emptyGate(), key: 'deploy', recoverBelow: '3' },
      { ...emptyGate(), key: 'queue', staleAfterSeconds: '30' },
      { ...emptyGate(), key: 'vendor', holdAt: 'lots' },
    ];
    expect(issuesOf(draft)).toEqual([
      { path: 'gates.0.recoverBelow', message: 'recover above hold' },
      { path: 'gates.1.recoverBelow', message: 'recover without hold' },
      { path: 'gates.2.staleAfterSeconds', message: 'stale after' },
      { path: 'gates.3.holdAt', message: 'number' },
    ]);
  });
});

describe('where the platform’s refusal of a dispatch belongs in the form', () => {
  const draft: DispatchFormValues = {
    ...values(FULL),
    labels: { include: ['release', 'nightly'], exclude: ['blocked'] },
  };

  it('reads the issues a DISPATCH_INVALID refusal carries', () => {
    expect(
      dispatchIssuesOf({
        code: 'DISPATCH_INVALID',
        issues: [
          { path: 'agents.1', message: 'No agent with the id "x".' },
          { path: 7, message: 'not a path' },
          'not an issue',
        ],
      }),
    ).toEqual([{ path: 'agents.1', message: 'No agent with the id "x".' }]);
    expect(dispatchIssuesOf(undefined)).toEqual([]);
    expect(dispatchIssuesOf({ issues: 'none' })).toEqual([]);
  });

  it('puts each issue under the field it names, and names a missing label', () => {
    const place = (path: string) =>
      placeIssue({ path, message: 'refused' }, draft);
    expect(place('agents.1')).toEqual({
      path: 'agents',
      problem: { kind: 'agent' },
    });
    expect(place('labels.include.1')).toEqual({
      path: 'labels.include',
      problem: { kind: 'label', name: 'nightly' },
    });
    expect(place('labels.exclude.0')).toEqual({
      path: 'labels.exclude',
      problem: { kind: 'label', name: 'blocked' },
    });
    expect(place('gates.0.labels.0')).toEqual({
      path: 'gates.0.labels',
      problem: { kind: 'label', name: 'ci' },
    });
    expect(place('standingRoles.0.agentId')).toEqual({
      path: 'standingRoles.0.agentId',
      problem: { kind: 'roleAgent' },
    });
    expect(place('standingRoles.0.taskId')).toEqual({
      path: 'standingRoles.0.taskId',
      problem: { kind: 'roleTask' },
    });
    expect(place('standingRoles.0.cron')).toEqual({
      path: 'standingRoles.0.cron',
      problem: { kind: 'cron' },
    });
  });

  it('keeps an issue the form has no field for on the form, in the platform’s words', () => {
    expect(
      placeIssue({ path: 'statuses', message: 'Unknown.' }, draft),
    ).toEqual({
      path: 'root.server',
      problem: { kind: 'other', message: 'statuses: Unknown.' },
    });
  });
});
