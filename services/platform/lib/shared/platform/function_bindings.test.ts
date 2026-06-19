import { describe, expect, it } from 'vitest';

import {
  type FunctionBinding,
  collectViewBindings,
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
  validateViewBindings,
} from './function_bindings';

const allowlist: FunctionBinding[] = [
  { path: 'tasks/queries:listTasksByOrg', mode: 'query' },
  { path: 'tasks/mutations:assignTask', mode: 'mutation' },
  { path: 'workflow_executions/actions:startWorkflowFromFile', mode: 'action' },
];

describe('isValidFunctionPath', () => {
  it('accepts the makeFunctionReference form (dir/file:export)', () => {
    expect(isValidFunctionPath('tasks/queries:listTasksByOrg')).toBe(true);
    expect(isValidFunctionPath('approvals/queries:listActive')).toBe(true);
  });
  it('rejects malformed paths', () => {
    expect(isValidFunctionPath('tasks.queries.listTasksByOrg')).toBe(false);
    expect(isValidFunctionPath('no-colon')).toBe(false);
    expect(isValidFunctionPath('tasks/queries:')).toBe(false);
    expect(isValidFunctionPath('a b:c')).toBe(false);
  });
});

describe('isFunctionAllowed', () => {
  it('allows a declared path (optionally checking mode)', () => {
    expect(isFunctionAllowed('tasks/queries:listTasksByOrg', allowlist)).toBe(
      true,
    );
    expect(
      isFunctionAllowed('tasks/mutations:assignTask', allowlist, 'mutation'),
    ).toBe(true);
  });
  it('rejects undeclared paths, wrong modes, and a missing allowlist', () => {
    expect(isFunctionAllowed('secret/admin:wipe', allowlist)).toBe(false);
    expect(
      isFunctionAllowed('tasks/mutations:assignTask', allowlist, 'query'),
    ).toBe(false);
    expect(isFunctionAllowed('tasks/queries:listTasksByOrg', undefined)).toBe(
      false,
    );
  });
});

describe('resolveBindingArgs', () => {
  const ctx = { organizationId: 'org_1', selected: { _id: 't1', title: 'X' } };
  it('substitutes $orgId, $selected, and $selected.<field>', () => {
    expect(resolveBindingArgs('$orgId', ctx)).toBe('org_1');
    expect(resolveBindingArgs('$selected', ctx)).toEqual(ctx.selected);
    expect(resolveBindingArgs('$selected._id', ctx)).toBe('t1');
  });
  it('recurses through nested records + arrays, leaving literals', () => {
    expect(
      resolveBindingArgs(
        { organizationId: '$orgId', input: { task: '$selected' }, n: 5 },
        ctx,
      ),
    ).toEqual({ organizationId: 'org_1', input: { task: ctx.selected }, n: 5 });
  });
});

describe('collectViewBindings + validateViewBindings', () => {
  const view = {
    data: {
      content: [
        {
          type: 'Collection',
          props: {
            query: { path: 'tasks/queries:listTasksByOrg' },
            actions: [
              {
                path: 'workflow_executions/actions:startWorkflowFromFile',
                mode: 'action',
              },
              { path: 'tasks/mutations:assignTask', mode: 'mutation' },
            ],
          },
        },
      ],
    },
  };

  it('collects query + action bindings from a Puck view', () => {
    expect(collectViewBindings(view)).toEqual([
      { path: 'tasks/queries:listTasksByOrg', mode: 'query' },
      {
        path: 'workflow_executions/actions:startWorkflowFromFile',
        mode: 'action',
      },
      { path: 'tasks/mutations:assignTask', mode: 'mutation' },
    ]);
  });

  it('passes when every bound path is allowlisted', () => {
    expect(validateViewBindings(view, allowlist)).toEqual([]);
  });

  it('flags a bound path missing from the allowlist', () => {
    const offending = {
      data: {
        content: [
          { type: 'Collection', props: { query: { path: 'secret/x:peek' } } },
        ],
      },
    };
    const errors = validateViewBindings(offending, allowlist);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('secret/x:peek');
  });
});
