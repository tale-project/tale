// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  resolveTaskOwnership,
  resolveTaskSubjectContract,
  taskSubjectEntries,
  type TaskOwnershipFields,
} from './use-task-subject-contract';

// Every task resolves to exactly one of the three ownership classes —
// automation / agent / human — and the arbitration order (assignee first:
// app, agent, user; then, for UNASSIGNED rows only, the creation stamp and
// the unique externalSystem fallback) is the rule the badge and the status
// choreography both hang off. Pinned here as a matrix.

const desk = {
  name: 'doc-verify-desk',
  deployedVersion: 3,
  taskContract: { workflow: 'doc-verify-desk', externalSystem: 'acme' },
};
const payroll = {
  name: 'payroll-desk',
  deployedVersion: 1,
  taskContract: { workflow: 'payroll-desk', externalSystem: 'acme' },
};

function task(overrides: Partial<TaskOwnershipFields>): TaskOwnershipFields {
  return { createdBy: 'user_1', createdByType: 'user', ...overrides };
}

describe('taskSubjectEntries', () => {
  it('keeps only deployed automations with a parsable contract', () => {
    const entries = taskSubjectEntries(
      [
        desk,
        { name: 'draft-only', taskContract: desk.taskContract },
        { name: 'broken', deployedVersion: 2, taskContract: { nope: true } },
        { name: 'contract-less', deployedVersion: 2 },
      ],
      'en',
    );
    expect(entries.map((entry) => entry.automationSlug)).toEqual([
      'doc-verify-desk',
    ]);
  });

  it('carries a parsable settings declaration and nulls a malformed one', () => {
    const settings = {
      forms: [
        {
          file: 'validation-policy.yaml',
          title: 'Validation policy',
          fields: [{ key: 'method', label: 'Method', type: 'text' }],
        },
      ],
    };
    const entries = taskSubjectEntries(
      [
        { ...desk, settings },
        { ...payroll, settings: { forms: [] } },
      ],
      'en',
    );
    expect(entries[0]?.settings?.forms[0]?.file).toBe('validation-policy.yaml');
    expect(entries[1]?.settings).toBeNull();
  });

  it('carries the declared name in the reader s language, never the slug', () => {
    const declared = {
      ...desk,
      presentation: {
        name: 'Document verification desk',
        i18n: { de: { name: 'Dokumentenprüfung-Arbeitsplatz' } },
      },
    };
    expect(taskSubjectEntries([declared], 'de')[0]?.displayName).toBe(
      'Dokumentenprüfung-Arbeitsplatz',
    );
    expect(taskSubjectEntries([declared], 'en')[0]?.displayName).toBe(
      'Document verification desk',
    );
    // No manifest: the slug read as a title, so a surface never shows `doc-verify-desk`.
    expect(taskSubjectEntries([desk], 'en')[0]?.displayName).toBe(
      'Doc verify desk',
    );
  });

  // The task surface answers "what is this thing" from the automation's OWN
  // description, live from the deployed version — never a copy written into
  // each task. Absent stays absent: the panel must be able to omit the line.
  it('carries the declared description in the reader s language, or none', () => {
    const declared = {
      ...desk,
      presentation: {
        name: 'Document verification desk',
        description:
          'Verifies a batch of incoming documents for completeness and consistency.',
        i18n: {
          de: { description: 'Prüft und validiert einen Dokumentenstapel.' },
        },
      },
    };
    expect(taskSubjectEntries([declared], 'de')[0]?.displayDescription).toBe(
      'Prüft und validiert einen Dokumentenstapel.',
    );
    // A locale that overrides only the name falls back to the authored English.
    expect(taskSubjectEntries([declared], 'fr')[0]?.displayDescription).toBe(
      'Verifies a batch of incoming documents for completeness and consistency.',
    );
    expect(
      taskSubjectEntries(
        [{ ...desk, presentation: { name: 'Desk' } }],
        'en',
      )[0],
    ).not.toHaveProperty('displayDescription');
    expect(taskSubjectEntries([desk], 'en')[0]).not.toHaveProperty(
      'displayDescription',
    );
  });
});

describe('resolveTaskOwnership', () => {
  it('automation: the automation ASSIGNEE is the strongest claim', () => {
    const ownership = resolveTaskOwnership(
      task({
        createdByType: 'user',
        createdBy: 'user_1',
        assigneeType: 'app',
        assigneeId: 'doc-verify-desk',
      }),
      [desk],
      'en',
    );
    expect(ownership).toMatchObject({
      kind: 'automation',
      automationSlug: 'doc-verify-desk',
    });
  });

  it('an automation assignee with no deployed contract falls through', () => {
    const ownership = resolveTaskOwnership(
      task({ assigneeType: 'app', assigneeId: 'retired-desk' }),
      [desk],
      'en',
    );
    expect(ownership).toEqual({ kind: 'human' });
  });

  it('automation: the creation stamp claims unassigned rows', () => {
    const ownership = resolveTaskOwnership(
      task({
        createdByType: 'app',
        createdBy: 'doc-verify-desk',
        assigneeType: 'agent',
        assigneeId: 'helper',
      }),
      [desk],
      'en',
    );
    // An agent assignee outranks the stamp — the assignment is the ownership.
    expect(ownership).toEqual({ kind: 'agent', agentId: 'helper' });
  });

  it('stamp-or-nothing: a gone automation never falls through to another', () => {
    const ownership = resolveTaskOwnership(
      task({
        createdByType: 'app',
        createdBy: 'retired-desk',
        externalSystem: 'acme',
      }),
      [desk],
      'en',
    );
    expect(ownership).toEqual({ kind: 'human' });
  });

  it('automation: an unassigned app-created row resolves via its stamp', () => {
    const ownership = resolveTaskOwnership(
      task({ createdByType: 'app', createdBy: 'doc-verify-desk' }),
      [desk],
      'en',
    );
    expect(ownership).toMatchObject({
      kind: 'automation',
      automationSlug: 'doc-verify-desk',
    });
  });

  it('agent: an explicit agent assignee beats the externalSystem fallback', () => {
    const ownership = resolveTaskOwnership(
      task({
        assigneeType: 'agent',
        assigneeId: 'helper',
        externalSystem: 'acme',
      }),
      [desk],
      'en',
    );
    expect(ownership).toEqual({ kind: 'agent', agentId: 'helper' });
  });

  it('automation: a unique externalSystem match claims unassigned pre-stamp tasks', () => {
    const ownership = resolveTaskOwnership(
      task({ externalSystem: 'acme' }),
      [desk],
      'en',
    );
    expect(ownership).toMatchObject({
      kind: 'automation',
      automationSlug: 'doc-verify-desk',
    });
  });

  it('human: a user assignee detaches the choreography (take-over)', () => {
    // The explicit handoff must actually transfer the board verbs — a task
    // handed to a person keeps NO automation ownership, whatever its
    // provenance stamp or externalSystem says.
    const ownership = resolveTaskOwnership(
      task({
        createdByType: 'app',
        createdBy: 'doc-verify-desk',
        externalSystem: 'acme',
        assigneeType: 'user',
        assigneeId: 'user_2',
      }),
      [desk],
      'en',
    );
    expect(ownership).toEqual({ kind: 'human' });
  });

  it('human: an ambiguous externalSystem match never guesses an owner', () => {
    const ownership = resolveTaskOwnership(
      task({ externalSystem: 'acme' }),
      [desk, payroll],
      'en',
    );
    expect(ownership).toEqual({ kind: 'human' });
  });

  it('human: a plain task', () => {
    expect(resolveTaskOwnership(task({}), [desk], 'en')).toEqual({
      kind: 'human',
    });
  });
});

describe('resolveTaskSubjectContract', () => {
  it('narrows to the automation class — agent-owned resolves to null', () => {
    const agentTask = task({
      assigneeType: 'agent',
      assigneeId: 'helper',
      externalSystem: 'acme',
    });
    expect(resolveTaskSubjectContract(agentTask, [desk], 'en')).toBeNull();
    expect(
      resolveTaskSubjectContract(
        task({ externalSystem: 'acme' }),
        [desk],
        'en',
      ),
    ).toMatchObject({ automationSlug: 'doc-verify-desk' });
  });
});
