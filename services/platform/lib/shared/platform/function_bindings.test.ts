import { describe, expect, it } from 'vitest';

import {
  type FunctionBinding,
  argsReferenceProjectId,
  argsReferenceViewState,
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
  it('substitutes $projectName for Form initial prefill', () => {
    expect(
      resolveBindingArgs('$projectName', {
        organizationId: 'org_1',
        projectName: 'SoftInstall Pro Ltd',
      }),
    ).toBe('SoftInstall Pro Ltd');
    expect(
      resolveBindingArgs('$projectName', { organizationId: 'org_1' }),
    ).toBeUndefined();
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
  it('resolves unbound $projectId to undefined so callers gate the call', () => {
    // Same posture as `$config:` / `$state.`: unresolved → undefined →
    // `bindingArgsResolved` false → empty state instead of a Convex reject.
    expect(resolveBindingArgs('$projectId', ctx)).toBeUndefined();
    expect(
      bindingArgsResolved(
        resolveBindingArgs(
          { organizationId: '$orgId', projectId: '$projectId' },
          ctx,
        ),
      ),
    ).toBe(false);
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
  it('$tpl: includes projectId and form input for Form submits', () => {
    const ctx = {
      organizationId: 'org_1',
      projectId: 'proj_9',
      input: { levyAccount: 'NP-1' },
    };
    expect(
      resolveBindingArgs('$tpl:northpack:{projectId}:profile.yaml', ctx),
    ).toBe('northpack:proj_9:profile.yaml');
    expect(resolveBindingArgs('$tpl:uid={levyAccount}', ctx)).toBe('uid=NP-1');
  });
  it('leaves a bare $label: string verbatim — the retired sentinel is no longer recognized', () => {
    // Display strings are literals now (UI translations are platform-owned);
    // `resolveBindingArgs` has no special case for this prefix any more, so a
    // value that happens to start with it just passes through unchanged.
    expect(
      resolveBindingArgs('$label:automation.task', { organizationId: 'org_1' }),
    ).toBe('$label:automation.task');
  });

  it('substitutes $state.<key> from the cross-block view state', () => {
    const sctx = {
      organizationId: 'org_1',
      state: { conversationId: 'c1', taskId: 't2' },
    };
    expect(resolveBindingArgs('$state.conversationId', sctx)).toBe('c1');
    expect(resolveBindingArgs('$state.taskId', sctx)).toBe('t2');
  });

  it('$state.<key> resolves to undefined when unset (gates, not a literal)', () => {
    // Same posture as `$config:` / `$projectId`: an unset state key must gate
    // the call so the block shows its awaiting placeholder.
    expect(
      resolveBindingArgs('$state.conversationId', {
        organizationId: 'org_1',
        state: {},
      }),
    ).toBeUndefined();
    expect(
      resolveBindingArgs('$state.conversationId', { organizationId: 'org_1' }),
    ).toBeUndefined();
  });

  it('substitutes $selection.ids with the multi-select ids', () => {
    expect(
      resolveBindingArgs('$selection.ids', {
        organizationId: 'org_1',
        selectionIds: ['c1', 'c2'],
      }),
    ).toEqual(['c1', 'c2']);
    expect(
      resolveBindingArgs('$selection.ids', { organizationId: 'org_1' }),
    ).toBeUndefined();
  });

  it('substitutes $input.<field> from the submitted values', () => {
    const ictx = {
      organizationId: 'org_1',
      input: { body: 'Hello', priority: 2 },
    };
    expect(resolveBindingArgs('$input.body', ictx)).toBe('Hello');
    expect(resolveBindingArgs('$input.priority', ictx)).toBe(2);
    expect(resolveBindingArgs('$input.missing', ictx)).toBeUndefined();
    expect(
      resolveBindingArgs('$input.body', { organizationId: 'org_1' }),
    ).toBeUndefined();
  });

  it('substitutes $lane with the drop-target lane', () => {
    expect(
      resolveBindingArgs('$lane', { organizationId: 'org_1', lane: 'done' }),
    ).toBe('done');
    expect(
      resolveBindingArgs('$lane', { organizationId: 'org_1' }),
    ).toBeUndefined();
  });

  it('resolves the new sentinels inside nested args trees', () => {
    expect(
      resolveBindingArgs(
        {
          organizationId: '$orgId',
          conversationId: '$state.conversationId',
          input: { body: '$input.body' },
          ids: '$selection.ids',
          status: '$lane',
        },
        {
          organizationId: 'org_1',
          state: { conversationId: 'c1' },
          input: { body: 'Hi' },
          selectionIds: ['a', 'b'],
          lane: 'open',
        },
      ),
    ).toEqual({
      organizationId: 'org_1',
      conversationId: 'c1',
      input: { body: 'Hi' },
      ids: ['a', 'b'],
      status: 'open',
    });
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
              source: { path: 'connectors/public_actions:listGitHubIssues' },
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
        path: 'connectors/public_actions:listGitHubIssues',
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
              source: { path: 'connectors/public_actions:listGitHubIssues' },
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
        path: 'connectors/public_actions:listGitHubIssues',
        mode: 'action',
      },
    ]);
  });

  it('collects nodes from Puck `zones` arrays like `content`', () => {
    const zoned = {
      data: {
        content: [
          {
            type: 'Collection',
            props: { query: { path: 'tasks/queries:listTasksByOrg' } },
          },
        ],
        zones: {
          'node-1:left': [
            {
              type: 'ConversationList',
              props: {
                query: { path: 'conversations/queries:listConversations' },
              },
            },
          ],
          'node-1:right': [
            {
              type: 'MessageComposer',
              props: {
                submit: {
                  path: 'conversations/mutations:replyToConversation',
                  mode: 'mutation',
                },
              },
            },
          ],
        },
      },
    };
    expect(collectViewBindings(zoned)).toEqual([
      { path: 'tasks/queries:listTasksByOrg', mode: 'query' },
      { path: 'conversations/queries:listConversations', mode: 'query' },
      {
        path: 'conversations/mutations:replyToConversation',
        mode: 'mutation',
      },
    ]);
  });

  it('collects the named single-action props (move/submit/improve/onOpen/attachmentAction)', () => {
    const node = (props: Record<string, unknown>) => ({
      data: { content: [{ type: 'X', props }] },
    });
    expect(
      collectViewBindings(
        node({ move: { path: 'tasks/mutations:moveTask', mode: 'mutation' } }),
      ),
    ).toEqual([{ path: 'tasks/mutations:moveTask', mode: 'mutation' }]);
    expect(
      collectViewBindings(
        node({
          submit: { path: 'tasks/mutations:createTask', mode: 'mutation' },
          improve: {
            path: 'conversations/actions:improveMessage',
            mode: 'action',
          },
        }),
      ),
    ).toEqual([
      { path: 'tasks/mutations:createTask', mode: 'mutation' },
      { path: 'conversations/actions:improveMessage', mode: 'action' },
    ]);
    expect(
      collectViewBindings(
        node({
          onOpen: {
            path: 'conversations/mutations:markRead',
            mode: 'mutation',
          },
          attachmentAction: {
            path: 'conversations/actions:getAttachment',
            mode: 'action',
          },
        }),
      ),
    ).toEqual([
      { path: 'conversations/mutations:markRead', mode: 'mutation' },
      { path: 'conversations/actions:getAttachment', mode: 'action' },
    ]);
  });

  it('collects the secondary `count` query binding (mode query)', () => {
    const withCount = {
      data: {
        content: [
          {
            type: 'ConversationList',
            props: {
              query: { path: 'conversations/queries:listConversations' },
              count: { path: 'conversations/queries:countByStatus' },
            },
          },
        ],
      },
    };
    expect(collectViewBindings(withCount)).toEqual([
      { path: 'conversations/queries:listConversations', mode: 'query' },
      { path: 'conversations/queries:countByStatus', mode: 'query' },
    ]);
  });

  it('collects `bulkActions[]` like `actions[]`', () => {
    const withBulk = {
      data: {
        content: [
          {
            type: 'ConversationList',
            props: {
              query: { path: 'conversations/queries:listConversations' },
              bulkActions: [
                {
                  path: 'conversations/mutations:bulkArchive',
                  mode: 'mutation',
                },
                { path: 'conversations/mutations:bulkClose', mode: 'mutation' },
              ],
            },
          },
        ],
      },
    };
    expect(collectViewBindings(withBulk)).toEqual([
      { path: 'conversations/queries:listConversations', mode: 'query' },
      { path: 'conversations/mutations:bulkArchive', mode: 'mutation' },
      { path: 'conversations/mutations:bulkClose', mode: 'mutation' },
    ]);
  });

  it('skips malformed single-action props (no path/mode) without throwing', () => {
    const malformed = {
      data: {
        content: [
          {
            type: 'X',
            props: {
              move: { path: 'tasks/mutations:moveTask' }, // mode missing
              submit: 'not-an-object',
              count: { args: {} }, // path missing
              bulkActions: [{ mode: 'mutation' }],
            },
          },
        ],
      },
    };
    expect(collectViewBindings(malformed)).toEqual([]);
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

  it('collects the `addAction` bound action (the header create affordance)', () => {
    const withAdd = {
      data: {
        content: [
          {
            type: 'Collection',
            props: {
              query: { path: 'tasks/queries:listTasksByOrg' },
              addAction: {
                path: 'tasks/mutations:createTask',
                mode: 'mutation',
              },
            },
          },
        ],
      },
    };
    expect(collectViewBindings(withAdd)).toEqual([
      { path: 'tasks/queries:listTasksByOrg', mode: 'query' },
      { path: 'tasks/mutations:createTask', mode: 'mutation' },
    ]);
  });
});

/**
 * Completeness guard: the collector must see EVERY binding-bearing prop the
 * view schema admits — a prop carrying `{path, mode}` that the collector
 * misses is invisible to publish-time allowlist validation. When a block
 * schema gains a new binding prop, extend the collector AND this fixture in
 * the same change.
 */
describe('collector covers every binding-bearing schema prop', () => {
  it('collects all binding props across blocks, tabs, columns and zones', () => {
    const everyBindingProp = {
      tabs: [
        {
          id: 'a',
          label: 'A',
          columns: [
            {
              content: [
                {
                  type: 'ConversationList',
                  props: {
                    query: { path: 'd/f:listQ' },
                    count: { path: 'd/f:countQ' },
                    onOpen: { path: 'd/f:openM', mode: 'mutation' },
                    bulkActions: [{ path: 'd/f:bulkM', mode: 'mutation' }],
                  },
                },
              ],
              zones: {
                'a:side': [
                  {
                    type: 'ConversationThread',
                    props: {
                      query: { path: 'd/f:threadQ' },
                      attachmentAction: {
                        path: 'd/f:attachM',
                        mode: 'mutation',
                      },
                      actions: [{ path: 'd/f:verbM', mode: 'mutation' }],
                    },
                  },
                ],
              },
            },
            {
              content: [
                {
                  type: 'MessageComposer',
                  props: {
                    submit: { path: 'd/f:sendM', mode: 'mutation' },
                    improve: { path: 'd/f:improveA', mode: 'action' },
                  },
                },
                {
                  type: 'Board',
                  props: {
                    query: { path: 'd/f:boardQ' },
                    move: { path: 'd/f:moveM', mode: 'mutation' },
                  },
                },
                {
                  type: 'ExternalList',
                  props: {
                    source: { path: 'd/f:sourceA' },
                    excludeBy: { query: { path: 'd/f:excludeQ' } },
                    addAction: { path: 'd/f:addM', mode: 'mutation' },
                  },
                },
                {
                  type: 'Form',
                  props: {
                    whenQuery: { path: 'd/f:gateQ' },
                    submit: { path: 'd/f:submitM', mode: 'mutation' },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const paths = collectViewBindings(everyBindingProp)
      .map((b) => b.path)
      .sort();
    expect(paths).toEqual(
      [
        'd/f:listQ',
        'd/f:countQ',
        'd/f:openM',
        'd/f:bulkM',
        'd/f:threadQ',
        'd/f:attachM',
        'd/f:verbM',
        'd/f:sendM',
        'd/f:improveA',
        'd/f:boardQ',
        'd/f:moveM',
        'd/f:sourceA',
        'd/f:excludeQ',
        'd/f:addM',
        'd/f:gateQ',
        'd/f:submitM',
      ].sort(),
    );
  });
});

describe('argsReferenceViewState', () => {
  it('detects $state. references at any depth', () => {
    expect(argsReferenceViewState('$state.selected')).toBe(true);
    expect(argsReferenceViewState({ a: { b: '$state.k' } })).toBe(true);
    expect(argsReferenceViewState(['x', '$state.y'])).toBe(true);
  });

  it('ignores literals, other sentinels, and non-strings', () => {
    expect(argsReferenceViewState('$tpl:{owner}/{repo}')).toBe(false);
    expect(argsReferenceViewState('state.x')).toBe(false);
    expect(argsReferenceViewState({ a: 42, b: null })).toBe(false);
    expect(argsReferenceViewState(undefined)).toBe(false);
  });
});

describe('argsReferenceProjectId', () => {
  it('detects $projectId at any depth', () => {
    expect(argsReferenceProjectId('$projectId')).toBe(true);
    expect(argsReferenceProjectId({ projectId: '$projectId' })).toBe(true);
    expect(argsReferenceProjectId(['x', { a: '$projectId' }])).toBe(true);
  });

  it('ignores other sentinels and non-strings', () => {
    expect(argsReferenceProjectId('$orgId')).toBe(false);
    expect(argsReferenceProjectId('$state.projectId')).toBe(false);
    expect(argsReferenceProjectId({ a: 42 })).toBe(false);
    expect(argsReferenceProjectId(undefined)).toBe(false);
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

  it('is false when a $state/$input/$lane/$selection reference is unavailable', () => {
    const ctx = { organizationId: 'org_1', state: {} };
    expect(
      bindingArgsResolved(
        resolveBindingArgs(
          { organizationId: '$orgId', conversationId: '$state.conversationId' },
          ctx,
        ),
      ),
    ).toBe(false);
    expect(
      bindingArgsResolved(resolveBindingArgs({ body: '$input.body' }, ctx)),
    ).toBe(false);
    expect(
      bindingArgsResolved(resolveBindingArgs({ status: '$lane' }, ctx)),
    ).toBe(false);
    expect(
      bindingArgsResolved(resolveBindingArgs({ ids: '$selection.ids' }, ctx)),
    ).toBe(false);
  });

  it('is true once the referenced view-state values are live', () => {
    const resolved = resolveBindingArgs(
      {
        organizationId: '$orgId',
        conversationId: '$state.conversationId',
        ids: '$selection.ids',
      },
      {
        organizationId: 'org_1',
        state: { conversationId: 'c1' },
        selectionIds: [],
      },
    );
    // An EMPTY selection is still a bound value (the action decides emptiness).
    expect(bindingArgsResolved(resolved)).toBe(true);
  });
});
