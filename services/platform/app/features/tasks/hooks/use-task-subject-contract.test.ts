// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  resolveTaskOwnership,
  resolveTaskSubjectContract,
  taskSubjectEntries,
  type TaskOwnershipFields,
} from './use-task-subject-contract';

// Every task resolves to exactly one of the three ownership classes —
// automation / agent / human — and the arbitration order (creation stamp,
// then agent assignee, then unique externalSystem fallback) is the rule the
// badge and the status choreography both hang off. Pinned here as a matrix.

const vat = {
  name: 'vat-desk',
  deployedVersion: 3,
  taskContract: { workflow: 'vat-desk', externalSystem: 'vatplus' },
};
const payroll = {
  name: 'payroll-desk',
  deployedVersion: 1,
  taskContract: { workflow: 'payroll-desk', externalSystem: 'vatplus' },
};

function task(overrides: Partial<TaskOwnershipFields>): TaskOwnershipFields {
  return { createdBy: 'user_1', createdByType: 'user', ...overrides };
}

describe('taskSubjectEntries', () => {
  it('keeps only deployed automations with a parsable contract', () => {
    const entries = taskSubjectEntries([
      vat,
      { name: 'draft-only', taskContract: vat.taskContract },
      { name: 'broken', deployedVersion: 2, taskContract: { nope: true } },
      { name: 'contract-less', deployedVersion: 2 },
    ]);
    expect(entries.map((entry) => entry.automationSlug)).toEqual(['vat-desk']);
  });
});

describe('resolveTaskOwnership', () => {
  it('automation: the write-once creation stamp wins', () => {
    const ownership = resolveTaskOwnership(
      task({
        createdByType: 'app',
        createdBy: 'vat-desk',
        assigneeType: 'agent',
        assigneeId: 'helper',
      }),
      [vat],
    );
    expect(ownership).toMatchObject({
      kind: 'automation',
      automationSlug: 'vat-desk',
    });
  });

  it('stamp-or-nothing: a gone automation never falls through to another', () => {
    const ownership = resolveTaskOwnership(
      task({
        createdByType: 'app',
        createdBy: 'retired-desk',
        externalSystem: 'vatplus',
      }),
      [vat],
    );
    expect(ownership).toEqual({ kind: 'human' });
  });

  it('agent: an explicit agent assignee beats the externalSystem fallback', () => {
    const ownership = resolveTaskOwnership(
      task({
        assigneeType: 'agent',
        assigneeId: 'helper',
        externalSystem: 'vatplus',
      }),
      [vat],
    );
    expect(ownership).toEqual({ kind: 'agent', agentId: 'helper' });
  });

  it('automation: a unique externalSystem match claims pre-stamp tasks', () => {
    const ownership = resolveTaskOwnership(
      task({ externalSystem: 'vatplus', assigneeType: 'user' }),
      [vat],
    );
    expect(ownership).toMatchObject({
      kind: 'automation',
      automationSlug: 'vat-desk',
    });
  });

  it('human: an ambiguous externalSystem match never guesses an owner', () => {
    const ownership = resolveTaskOwnership(
      task({ externalSystem: 'vatplus' }),
      [vat, payroll],
    );
    expect(ownership).toEqual({ kind: 'human' });
  });

  it('human: a plain task', () => {
    expect(resolveTaskOwnership(task({}), [vat])).toEqual({ kind: 'human' });
  });
});

describe('resolveTaskSubjectContract', () => {
  it('narrows to the automation class — agent-owned resolves to null', () => {
    const agentTask = task({
      assigneeType: 'agent',
      assigneeId: 'helper',
      externalSystem: 'vatplus',
    });
    expect(resolveTaskSubjectContract(agentTask, [vat])).toBeNull();
    expect(
      resolveTaskSubjectContract(task({ externalSystem: 'vatplus' }), [vat]),
    ).toMatchObject({ automationSlug: 'vat-desk' });
  });
});
