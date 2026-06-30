import { describe, expect, it } from 'vitest';

import {
  type FunctionBinding,
  bindingArgsResolved,
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
  it('substitutes $result and $result.<field> for onSuccess effects', () => {
    const rctx = { organizationId: 'org_1', result: { taskId: 't9' } };
    expect(resolveBindingArgs('$result', rctx)).toEqual(rctx.result);
    expect(resolveBindingArgs('$result.taskId', rctx)).toBe('t9');
    // An openDetail effect: only the templated id is substituted; the rest stays.
    expect(
      resolveBindingArgs(
        { kind: 'openDetail', subjectType: 'task', id: '$result.taskId' },
        rctx,
      ),
    ).toEqual({ kind: 'openDetail', subjectType: 'task', id: 't9' });
  });
  it('leaves $result.<field> untouched when no result is in context', () => {
    expect(resolveBindingArgs('$result.taskId', ctx)).toBe('$result.taskId');
  });
  it('substitutes $projectId for project-scoped apps', () => {
    expect(
      resolveBindingArgs('$projectId', {
        organizationId: 'org_1',
        projectId: 'proj_1',
      }),
    ).toBe('proj_1');
  });
  it('leaves $projectId as a literal when no project is bound (org-scoped)', () => {
    // Fail-visible: an org-scoped app that mis-binds $projectId sends the literal,
    // not a silent `undefined`, into a project-gated call.
    expect(resolveBindingArgs('$projectId', ctx)).toBe('$projectId');
  });
  it('interpolates $tpl: row fields into a string ({field} syntax)', () => {
    const tctx = {
      organizationId: 'org_1',
      selected: { owner: 'acme', repo: 'app', number: 42 },
    };
    expect(resolveBindingArgs('$tpl:{owner}/{repo}#{number}', tctx)).toBe(
      'acme/app#42',
    );
    // Unknown fields stay verbatim (fail-visible).
    expect(resolveBindingArgs('$tpl:{missing}', tctx)).toBe('{missing}');
  });
  it('substitutes $config:<key> from the per-install config', () => {
    const cctx = {
      organizationId: 'org_1',
      config: { owner: 'acme', repo: 'widgets' },
    };
    expect(resolveBindingArgs('$config:owner', cctx)).toBe('acme');
    expect(resolveBindingArgs('$config:repo', cctx)).toBe('widgets');
    // Unset key → undefined (a visible miss, not a literal).
    expect(resolveBindingArgs('$config:missing', cctx)).toBeUndefined();
  });
  it('$tpl: mixes config and row fields so one key can target the configured repo', () => {
    const ctx = {
      organizationId: 'org_1',
      config: { owner: 'acme', repo: 'widgets' },
      selected: { number: 42 },
    };
    expect(resolveBindingArgs('$tpl:{owner}/{repo}#{number}', ctx)).toBe(
      'acme/widgets#42',
    );
  });
  it('resolves $label: via the pack catalog, then interpolates the row', () => {
    const lctx = {
      organizationId: 'org_1',
      selected: { title: 'Fix bug', number: 7 },
      labels: { 'app.task': 'Resolve {title} (#{number})' },
    };
    expect(resolveBindingArgs('$label:app.task', lctx)).toBe(
      'Resolve Fix bug (#7)',
    );
  });
  it('falls back to the $label: key itself when no catalog entry exists', () => {
    expect(
      resolveBindingArgs('$label:missing.key', {
        organizationId: 'org_1',
        selected: {},
      }),
    ).toBe('missing.key');
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

  it('collects an action-sourced list `source` (mode defaults to action)', () => {
    const sourced = {
      data: {
        content: [
          {
            type: 'ExternalList',
            props: {
              source: { path: 'integrations/public_actions:listGitHubIssues' },
              actions: [
                {
                  path: 'tasks/public_actions:createTaskFromExternalIssue',
                  mode: 'action',
                },
              ],
            },
          },
        ],
      },
    };
    expect(collectViewBindings(sourced)).toEqual([
      {
        path: 'integrations/public_actions:listGitHubIssues',
        mode: 'action',
      },
      {
        path: 'tasks/public_actions:createTaskFromExternalIssue',
        mode: 'action',
      },
    ]);
  });

  it('collects an ExternalList `excludeBy` cross-reference query (mode query)', () => {
    const withExclude = {
      data: {
        content: [
          {
            type: 'ExternalList',
            props: {
              source: { path: 'integrations/public_actions:listGitHubIssues' },
              excludeBy: {
                query: { path: 'tasks/queries:listTasksByOrg' },
                refField: 'externalId',
                rowKeyTemplate: 'tale-project/tale#{number}',
              },
            },
          },
        ],
      },
    };
    expect(collectViewBindings(withExclude)).toEqual([
      { path: 'tasks/queries:listTasksByOrg', mode: 'query' },
      {
        path: 'integrations/public_actions:listGitHubIssues',
        mode: 'action',
      },
    ]);
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

describe('bindingArgsResolved', () => {
  it('is true when every value is bound (no undefined)', () => {
    const resolved = resolveBindingArgs(
      { organizationId: '$orgId', owner: '$config:owner', state: 'open' },
      { organizationId: 'org_1', config: { owner: 'acme' } },
    );
    expect(bindingArgsResolved(resolved)).toBe(true);
  });

  it('is false when a $config: reference is unset (resolves to undefined)', () => {
    const resolved = resolveBindingArgs(
      { organizationId: '$orgId', owner: '$config:owner' },
      { organizationId: 'org_1', config: {} },
    );
    expect(bindingArgsResolved(resolved)).toBe(false);
  });

  it('recurses through nested objects and arrays', () => {
    expect(bindingArgsResolved({ a: { b: [1, 'x', true] } })).toBe(true);
    expect(bindingArgsResolved({ a: { b: [1, undefined] } })).toBe(false);
    expect(bindingArgsResolved([{ ok: 'y' }, { ok: undefined }])).toBe(false);
  });

  it('treats null as bound (only undefined gates the call)', () => {
    expect(bindingArgsResolved({ a: null })).toBe(true);
  });
});
