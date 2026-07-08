/**
 * The automation-view schema contract. Pins three things: (1) BACK-COMPAT — a
 * representative pack-authored view document (no builtin bundle ships JSON
 * views anymore — the email inbox and the issue desk both retired theirs —
 * but uploaded private bundles still do) parses VERBATIM and round-trips
 * unchanged through the passthrough posture; (2) STRICTNESS — unknown block
 * types, missing discriminators, malformed function paths, and unknown effect
 * kinds are rejected; (3) the v2 block vocabulary (StatGrid/ChartCard/
 * DetailPanel/Form/Board/ConversationList/ConversationThread/MessageComposer/
 * AgentChat) parses — these schemas ARE the contract the block implementations
 * build against.
 */
import { describe, expect, it } from 'vitest';

import {
  actionEffectSchema,
  automationTabSchema,
  automationViewSchema,
  blockNodeSchema,
  boundActionSchema,
  columnSpecSchema,
  formFieldSchema,
  functionModeSchema,
  functionPathSchema,
  labelStringSchema,
  puckDataSchema,
  queryBindingSchema,
  sourceBindingSchema,
} from './automation_views';

/** A minimal well-formed view wrapping `content` in a flat data document. */
const viewWith = (content: unknown[]): unknown => ({
  id: 'v',
  data: { root: { props: {} }, content },
});

describe('automationViewSchema — back-compat with a pack-authored view document', () => {
  // A representative tabbed split view of the shape uploaded bundles author
  // (formerly shipped verbatim as the email bundles' `views/inbox.json`),
  // including an authored extra field the passthrough posture must keep.
  const packView = {
    id: 'inbox',
    title: '$label:pack.title',
    description: 'A plain literal description',
    authoredExtra: { keep: true },
    tabs: [
      {
        id: 'open',
        label: '$label:pack.tab.open',
        layout: 'split',
        columns: [
          {
            root: { props: {} },
            zones: {},
            content: [
              {
                type: 'ConversationList',
                props: {
                  id: 'open',
                  query: {
                    path: 'conversations/queries:listConversationsPaginated',
                    args: { organizationId: '$orgId', status: 'open' },
                  },
                  perPage: 30,
                  item: {
                    titleField: 'title',
                    senderField: 'senderName',
                    previewField: 'lastMessagePreview',
                    timestampField: 'lastMessageAt',
                    unreadField: 'unread_count',
                  },
                  selection: { stateKey: 'conversationId', idField: '_id' },
                  emptyState: { titleKey: '$label:pack.empty.open' },
                },
              },
            ],
          },
          {
            root: { props: {} },
            zones: {},
            content: [
              {
                type: 'ConversationThread',
                props: {
                  query: {
                    path: 'conversations/queries:getConversationWithMessages',
                    args: {
                      conversationId: '$state.conversationId',
                      organizationId: '$orgId',
                    },
                  },
                  message: {
                    authorField: 'sender',
                    bodyField: 'content',
                    bodyFormat: 'html',
                    timestampField: 'timestamp',
                    directionField: 'isCustomer',
                  },
                  placeholderKey: '$label:pack.thread.placeholder',
                },
              },
              {
                type: 'MessageComposer',
                props: {
                  submit: {
                    path: 'conversations/mutations:replyToConversation',
                    mode: 'mutation',
                    args: {
                      conversationId: '$state.conversationId',
                      organizationId: '$orgId',
                      content: '$input.body',
                    },
                  },
                  requiresState: 'conversationId',
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it('parses the tabbed split document verbatim', () => {
    const res = automationViewSchema.safeParse(packView);
    expect(res.success, res.error?.message).toBe(true);
  });

  it('round-trips the document unchanged (passthrough keeps every field)', () => {
    // The strict schema must never strip an authored field — the publish path
    // may substitute the parsed output for the raw doc without data loss.
    expect(automationViewSchema.parse(packView)).toEqual(packView);
  });
});

describe('automationViewSchema — rejection paths', () => {
  it('rejects an unknown block type', () => {
    const res = automationViewSchema.safeParse(
      viewWith([{ type: 'Bogus', props: {} }]),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a node missing the type discriminator', () => {
    const res = automationViewSchema.safeParse(
      viewWith([{ props: { text: 'x' } }]),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a malformed function path', () => {
    const res = automationViewSchema.safeParse(
      viewWith([
        { type: 'Collection', props: { query: { path: 'no-colon-here' } } },
      ]),
    );
    expect(res.success).toBe(false);
  });

  it('rejects an unknown effect kind', () => {
    const res = automationViewSchema.safeParse(
      viewWith([
        {
          type: 'Collection',
          props: {
            query: { path: 'tasks/queries:listTasksByProjectPaginated' },
            actions: [
              {
                path: 'tasks/mutations:updateTaskStatus',
                mode: 'mutation',
                onSuccess: { kind: 'explode' },
              },
            ],
          },
        },
      ]),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a view with neither data nor tabs (and empty tabs)', () => {
    expect(automationViewSchema.safeParse({ id: 'v' }).success).toBe(false);
    expect(automationViewSchema.safeParse({ id: 'v', tabs: [] }).success).toBe(
      false,
    );
  });
});

describe('automationViewSchema — versioning', () => {
  it('tolerates an absent version (absent = v1)', () => {
    const res = automationViewSchema.safeParse(viewWith([]));
    expect(res.success).toBe(true);
  });

  it('accepts a string version and rejects a non-string one', () => {
    const doc = viewWith([]) as Record<string, unknown>;
    expect(
      automationViewSchema.safeParse({ ...doc, version: '2.0.0' }).success,
    ).toBe(true);
    expect(automationViewSchema.safeParse({ ...doc, version: 2 }).success).toBe(
      false,
    );
  });
});

describe('automationViewSchema — tabbed shell', () => {
  it('accepts split/columns tab layouts with column documents', () => {
    const tab = {
      id: 'open',
      label: '$label:inbox.tab.open',
      layout: 'split',
      columns: [
        { root: { props: {} }, content: [] },
        { root: { props: {} }, content: [] },
      ],
    };
    expect(automationTabSchema.safeParse(tab).success).toBe(true);
    expect(
      automationViewSchema.safeParse({ id: 'inbox', tabs: [tab] }).success,
    ).toBe(true);
    expect(
      automationTabSchema.safeParse({ ...tab, layout: 'floating' }).success,
    ).toBe(false);
  });

  it('defaults an absent Puck root (Render tolerates it at runtime)', () => {
    const parsed = puckDataSchema.parse({ content: [] });
    expect(parsed.root).toEqual({ props: {} });
  });
});

describe('shared fragments', () => {
  it('functionPathSchema accepts reference paths and rejects malformed ones', () => {
    expect(
      functionPathSchema.safeParse('tasks/queries:listTasksByOrg').success,
    ).toBe(true);
    expect(functionPathSchema.safeParse('tasks/queries').success).toBe(false);
    expect(functionPathSchema.safeParse('bad path:fn').success).toBe(false);
  });

  it('binding fragments keep args opaque (sentinels are runtime concerns)', () => {
    expect(
      queryBindingSchema.safeParse({
        path: 'tasks/queries:listTasksByProject',
        args: { organizationId: '$orgId', taskId: '$state.taskId' },
      }).success,
    ).toBe(true);
    expect(
      sourceBindingSchema.safeParse({
        path: 'integrations/public_actions:listUntrackedGitHubIssues',
        mode: 'action',
        args: { ids: '$selection.ids', lane: '$lane' },
      }).success,
    ).toBe(true);
    expect(functionModeSchema.safeParse('mutation').success).toBe(true);
    expect(functionModeSchema.safeParse('subscription').success).toBe(false);
    expect(labelStringSchema.safeParse('$label:x.title').success).toBe(true);
  });

  it('boundActionSchema covers the full BoundActionSpec surface', () => {
    const res = boundActionSchema.safeParse({
      label: 'Create',
      labelKey: 'issues.createTask',
      path: 'tasks/public_actions:createTaskFromExternalIssue',
      mode: 'action',
      args: { title: '$selected.title' },
      confirm: true,
      when: 'status == open',
      variant: 'primary',
      onSuccess: {
        kind: 'openDetail',
        subjectType: 'task',
        id: '$result.taskId',
      },
      doneWhen: 'created == true',
      doneLabelKey: 'list.created',
      doneLabel: 'Created',
    });
    expect(res.success, res.error?.message).toBe(true);
  });

  it('actionEffectSchema admits the v2 toast/setState kinds', () => {
    expect(
      actionEffectSchema.safeParse({ kind: 'toast', titleKey: 'inbox.sent' })
        .success,
    ).toBe(true);
    expect(
      actionEffectSchema.safeParse({
        kind: 'setState',
        key: 'conversationId',
        value: null,
      }).success,
    ).toBe(true);
    expect(
      actionEffectSchema.safeParse({
        kind: 'navigate',
        to: '/dashboard/$id/tasks',
        params: { id: '$orgId' },
      }).success,
    ).toBe(true);
  });

  it('columnSpecSchema accepts specs and rejects unknown kinds', () => {
    expect(
      columnSpecSchema.safeParse({
        field: 'createdAt',
        labelKey: 'col.created',
        kind: 'datetime',
        size: 160,
        flex: true,
        align: 'right',
      }).success,
    ).toBe(true);
    expect(
      columnSpecSchema.safeParse({ field: 't', kind: 'nope' }).success,
    ).toBe(false);
    const res = automationViewSchema.safeParse(
      viewWith([
        {
          type: 'Collection',
          props: {
            query: { path: 'tasks/queries:listTasksByProjectPaginated' },
            columns: [{ field: 'title' }, { field: 'status', kind: 'badge' }],
          },
        },
      ]),
    );
    expect(res.success, res.error?.message).toBe(true);
  });

  it('valueLabels/badgeLabels map raw enum values to display strings (additive)', () => {
    // Badge-kind cell labels on a column spec — typed, `$label:`-capable.
    const spec = columnSpecSchema.parse({
      field: 'status',
      kind: 'badge',
      valueLabels: { in_progress: '$label:tasks.status.inProgress' },
    });
    expect(spec.valueLabels).toEqual({
      in_progress: '$label:tasks.status.inProgress',
    });
    expect(
      columnSpecSchema.safeParse({ field: 's', valueLabels: { a: 1 } }).success,
    ).toBe(false);

    // The shared list-filter grammar (Collection + ConversationList) carries
    // `valueLabels`; the ConversationList item map carries `badgeLabels`.
    const res = automationViewSchema.safeParse(
      viewWith([
        {
          type: 'Collection',
          props: {
            query: { path: 'tasks/queries:listTasksByProjectPaginated' },
            filters: [
              {
                field: 'status',
                values: ['todo', 'done'],
                valueLabels: { todo: '$label:tasks.status.todo' },
              },
            ],
          },
        },
        {
          type: 'ConversationList',
          props: {
            query: { path: 'conversations/queries:listConversationsPaginated' },
            item: {
              titleField: 'subject',
              badgeField: 'status',
              badgeLabels: { open: '$label:inbox.status.open' },
            },
            filters: [
              {
                field: 'status',
                values: ['open', 'closed'],
                valueLabels: { open: '$label:inbox.status.open' },
              },
            ],
            selection: { stateKey: 'conversationId', idField: '_id' },
          },
        },
      ]),
    );
    expect(res.success, res.error?.message).toBe(true);

    // A non-string filter label value is rejected (the props are declared,
    // not passthrough-tolerated).
    const bad = automationViewSchema.safeParse(
      viewWith([
        {
          type: 'Collection',
          props: {
            query: { path: 'tasks/queries:listTasksByProjectPaginated' },
            filters: [
              { field: 'status', values: ['todo'], valueLabels: { todo: 1 } },
            ],
          },
        },
      ]),
    );
    expect(bad.success).toBe(false);
  });

  it('formFieldSchema keeps the manifest grammar and adds select/required', () => {
    expect(
      formFieldSchema.safeParse({
        key: 'priority',
        type: 'select',
        label: 'Priority',
        options: [{ value: 'high', label: 'High' }],
        required: true,
      }).success,
    ).toBe(true);
    expect(
      formFieldSchema.safeParse({
        key: 'x',
        type: 'date',
        label: 'X',
      }).success,
    ).toBe(false);
  });
});

describe('v2 block vocabulary — one sample per block parses', () => {
  const samples: Array<[string, unknown]> = [
    [
      'StatGrid',
      {
        type: 'StatGrid',
        props: {
          query: {
            path: 'tasks/queries:getTaskStatsByProject',
            args: { organizationId: '$orgId', projectId: '$projectId' },
          },
          cols: 3,
          stats: [
            {
              labelKey: 'tasks.stats.open',
              valueField: 'open',
              format: 'number',
              trendField: 'openTrend',
              sparklineField: 'openSparkline',
            },
          ],
        },
      },
    ],
    [
      'ChartCard',
      {
        type: 'ChartCard',
        props: {
          titleKey: 'tasks.chart.throughput',
          query: { path: 'task_metrics/queries:getProjectTaskMetrics' },
          itemsKey: 'days',
          chart: {
            kind: 'area',
            xField: 'date',
            series: [{ field: 'created', labelKey: 'tasks.chart.created' }],
          },
          height: 240,
        },
      },
    ],
    [
      'DetailPanel',
      {
        type: 'DetailPanel',
        props: {
          query: {
            path: 'tasks/queries:getTask',
            args: { taskId: '$state.taskId' },
          },
          cols: 2,
          fields: [
            { labelKey: 'tasks.detail.title', field: 'title' },
            {
              labelKey: 'tasks.detail.status',
              field: 'status',
              kind: 'badge',
            },
            {
              labelKey: 'tasks.detail.issue',
              field: 'externalUrl',
              kind: 'link',
            },
          ],
          actions: [
            {
              labelKey: 'list.start',
              path: 'tasks/public_actions:startTaskWorkflow',
              mode: 'action',
            },
          ],
        },
      },
    ],
    [
      'Form',
      {
        type: 'Form',
        props: {
          title: '$label:inbox.compose',
          fields: [
            {
              key: 'subject',
              type: 'string',
              label: 'Subject',
              required: true,
            },
            {
              key: 'priority',
              type: 'select',
              label: 'Priority',
              options: [{ value: 'high', label: 'High' }],
            },
          ],
          initial: { subject: '' },
          submit: {
            labelKey: 'inbox.send',
            path: 'conversations/mutations:replyToConversation',
            mode: 'mutation',
            args: { subject: '$input.subject', priority: '$input.priority' },
          },
          onSuccess: { kind: 'toast', titleKey: 'inbox.sent' },
        },
      },
    ],
    [
      'Board',
      {
        type: 'Board',
        props: {
          title: '$label:tasks.boardTitle',
          query: {
            path: 'tasks/queries:listTasksByProject',
            args: { organizationId: '$orgId', projectId: '$projectId' },
          },
          itemsKey: 'tasks',
          groupBy: 'status',
          lanes: [
            { value: 'todo', labelKey: 'tasks.lane.todo' },
            { value: 'in_progress', labelKey: 'tasks.lane.inProgress' },
          ],
          card: {
            titleField: 'title',
            subtitleField: 'number',
            metaFields: ['assignee'],
            badgeField: 'priority',
          },
          subjectType: 'task',
          move: {
            path: 'tasks/mutations:moveTask',
            mode: 'mutation',
            args: { status: '$lane' },
          },
          actions: [
            {
              labelKey: 'list.start',
              path: 'tasks/public_actions:startTaskWorkflow',
              mode: 'action',
              when: 'status == todo',
            },
          ],
          onCardClick: {
            kind: 'openDetail',
            subjectType: 'task',
            id: '$selected._id',
          },
        },
      },
    ],
    [
      'ConversationList',
      {
        type: 'ConversationList',
        props: {
          title: '$label:inbox.listTitle',
          query: {
            path: 'conversations/queries:listConversationsPaginated',
            args: { organizationId: '$orgId', status: 'open' },
          },
          count: {
            path: 'conversations/queries:approxCountConversationsByStatus',
            args: { organizationId: '$orgId' },
          },
          perPage: 25,
          item: {
            titleField: 'subject',
            senderField: 'fromAddress',
            previewField: 'preview',
            timestampField: 'lastMessageAt',
            unreadField: 'unread',
            badgeField: 'status',
          },
          filters: [{ field: 'status', values: ['open', 'closed'] }],
          selection: { stateKey: 'conversationId', idField: '_id' },
          onOpen: {
            path: 'conversations/mutations:markConversationRead',
            mode: 'mutation',
            args: { conversationId: '$state.conversationId' },
          },
          bulkActions: [
            {
              labelKey: 'inbox.archive',
              path: 'conversations/mutations:bulkUpdateStatus',
              mode: 'mutation',
              args: { ids: '$selection.ids', status: 'archived' },
            },
          ],
          emptyState: { titleKey: 'inbox.emptyTitle' },
        },
      },
    ],
    [
      'ConversationThread',
      {
        type: 'ConversationThread',
        props: {
          query: {
            path: 'conversations/queries:getConversationWithMessages',
            args: { conversationId: '$state.conversationId' },
          },
          message: {
            authorField: 'fromAddress',
            bodyField: 'body',
            timestampField: 'sentAt',
            directionField: 'direction',
            bodyFormat: 'markdown',
          },
          placeholderKey: 'inbox.pickConversation',
          attachmentAction: {
            path: 'conversations/actions:downloadAttachment',
            mode: 'action',
            args: { attachmentId: '$selected.attachmentId' },
          },
        },
      },
    ],
    [
      'MessageComposer',
      {
        type: 'MessageComposer',
        props: {
          submit: {
            labelKey: 'inbox.send',
            path: 'conversations/mutations:replyToConversation',
            mode: 'mutation',
            args: {
              conversationId: '$state.conversationId',
              body: '$input.body',
            },
          },
          improve: {
            path: 'conversations/actions:improveMessage',
            mode: 'action',
            args: { draft: '$input.body' },
          },
          requiresState: 'conversationId',
          placeholderKey: 'inbox.replyPlaceholder',
          submitLabelKey: 'inbox.send',
          onSuccess: { kind: 'toast', titleKey: 'inbox.sent' },
        },
      },
    ],
    [
      'AgentChat',
      {
        type: 'AgentChat',
        props: {
          title: '$label:tasks.discuss',
          role: 'implementer',
          subject: { type: 'task', idField: '_id' },
          contextTemplate: 'Task {number}: {title}',
          placeholderKey: 'tasks.askImplementer',
          height: 480,
        },
      },
    ],
  ];

  it.each(samples)('%s parses as a block node and inside a view', (_, node) => {
    const nodeRes = blockNodeSchema.safeParse(node);
    expect(nodeRes.success, nodeRes.error?.message).toBe(true);
    const viewRes = automationViewSchema.safeParse(viewWith([node]));
    expect(viewRes.success, viewRes.error?.message).toBe(true);
  });

  it('requires the core bindings (a Board without move/groupBy is rejected)', () => {
    const res = blockNodeSchema.safeParse({
      type: 'Board',
      props: {
        query: { path: 'tasks/queries:listTasksByProject' },
        lanes: [{ value: 'todo', labelKey: 'x.todo' }],
        card: { titleField: 'title' },
      },
    });
    expect(res.success).toBe(false);
  });
});
