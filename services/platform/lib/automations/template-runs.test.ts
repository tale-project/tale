// @vitest-environment node

/**
 * The shipped templates as production runs them: at their largest batch,
 * with an item that fails, and carrying on from the run before. Each
 * template's own tests (in its workflow) hold its happy paths; these hold
 * what a test document cannot express — a backlog bigger than one run, a
 * failure in one item out of many, two runs in a row — against the real
 * documents, with the connectors' calls stood in for.
 */

import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConnectorDefinitions } from '../connectors/catalog';
import { inProcessLiveRunner } from '../connectors/in-process-live';
import { loadConnectors } from '../connectors/registry';
import { execute } from '../engine/core/execute';
import { setCodeRunner } from '../engine/core/runner';
import { nodeTypes, registerNodeType } from '../engine/core/slots';
import type { Automation, NodeDef } from '../engine/core/types';
import { compileSchema } from '../engine/core/validate/schema';
import { nodeVmRunner } from '../engine/runners/node-vm';
import { loadAutomationTemplates } from './templates';

const REPO = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../..',
);
const SYSTEM = path.join(REPO, 'configs/platform/system');

setCodeRunner(nodeVmRunner());
loadConnectors(SYSTEM);
const templates = loadAutomationTemplates({
  root: SYSTEM,
  packsRoot: path.join(REPO, 'configs/platform/custom'),
});

function documentOf(slug: string): Automation {
  const found = templates.find((template) => template.slug === slug);
  if (found === undefined) throw new Error(`no shipped template "${slug}"`);
  return found.automation;
}

/** The document with one step's input changed, as an answer would. */
function withInput(
  doc: Automation,
  nodeId: string,
  input: Record<string, unknown>,
): Automation {
  return {
    ...doc,
    nodes: doc.nodes.map((node): NodeDef =>
      node.id === nodeId
        ? { ...node, input: { ...node.input, ...input } }
        : node,
    ),
  };
}

/** What a run's inputs allow at most for one of them. */
function maximumOf(doc: Automation, field: string): number | undefined {
  const properties = doc.inputs?.properties;
  if (typeof properties !== 'object' || properties === null) return undefined;
  const declared: unknown = Reflect.get(properties, field);
  if (typeof declared !== 'object' || declared === null) return undefined;
  const maximum: unknown = Reflect.get(declared, 'maximum');
  return typeof maximum === 'number' ? maximum : undefined;
}

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).toReversed()) restore();
});

/** Stand in for every call of a connector action, for one test. */
function standIn(
  type: string,
  mock: (input: Record<string, unknown>) => unknown,
): void {
  const def = nodeTypes().get(type);
  if (def?.connector === undefined) throw new Error(`no action "${type}"`);
  registerNodeType({
    ...def,
    connector: {
      ...def.connector,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a connector's input is the object its schema checked
      mock: (input) => mock(input as Record<string, unknown>),
    },
  });
  restores.push(() => registerNodeType(def));
}

function effectsOf(
  result: Awaited<ReturnType<typeof execute>>,
  connector: string,
): Array<Record<string, unknown>> {
  return result.effects
    .filter((effect) => effect.connector === connector)
    .map((effect) =>
      typeof effect.input === 'object' && effect.input !== null
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a connector effect's input is its resolved input object
          (effect.input as Record<string, unknown>)
        : {},
    );
}

function inputOfStep(
  result: Awaited<ReturnType<typeof execute>>,
  nodeId: string,
): unknown {
  return result.trace.find((entry) => entry.node === nodeId)?.input;
}

/** A pull request due a review, as the review queue answers it. */
function duePull(number: number): Record<string, unknown> {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/tale/tale/pull/${number}`,
    headSha: `sha-${number}`,
    author: 'ada',
    updatedAt: '2026-10-14T08:00:00Z',
  };
}

function queueOf(pulls: Array<Record<string, unknown>>, more = 0) {
  return {
    viewer: 'tale-reviewer',
    open: pulls.length + more,
    scanned: pulls.length + more,
    pulls,
    waiting: more,
    skipped: { drafts: 0, own: 0, reviewed: 0 },
  };
}

/** An Inbox thread waiting on the team, as list_untriaged answers it. */
function waiting(conversationId: string): Record<string, unknown> {
  return {
    conversationId,
    subject: `About ${conversationId}`,
    contact: { name: 'Mia', email: 'mia@example.com' },
    lastInboundAt: '2026-10-14T08:00:00.000Z',
    lastInboundText: 'Could you tell me when my order ships?',
    unreadCount: 1,
    assigned: false,
    url: `/dashboard/org/conversations/open?conversation=${conversationId}`,
  };
}

function verdict(
  conversationId: string,
  action: 'reply' | 'no_reply',
): Record<string, string> {
  return {
    conversationId,
    action,
    priority: action === 'reply' ? 'high' : 'low',
    reason: action === 'reply' ? 'Asks for a date.' : 'A receipt.',
  };
}

/** An open issue as GitHub's issues listing answers it. */
function issue(number: number, updatedAt: string): Record<string, unknown> {
  return {
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/tale/tale/issues/${number}`,
    body: 'Steps to reproduce.',
    labels: [],
    updated_at: updatedAt,
  };
}

/** The yaml-js live body of a shipped connector action. */
function liveBodyOf(connector: string, action: string): string {
  const found = loadConnectorDefinitions({ root: SYSTEM })
    .find((candidate) => candidate.name === connector)
    ?.actions.find((candidate) => candidate.name === action);
  if (found?.backend?.kind !== 'yaml-js') {
    throw new Error(`${connector}.${action} has no yaml-js body`);
  }
  return found.backend.live;
}

function reply(status: number, body: unknown) {
  return {
    status,
    json: () => body,
    text: () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const FIRED = 1_791_000_000_000;

describe('a shipped template stays inside the execution limit at its largest batch [AUTO-R72]', () => {
  it('bounds every batch a run takes, and refuses a bigger one', () => {
    for (const slug of [
      'github/review-pull-requests',
      'github/triage-issues',
      'gmail/triage-inbox',
      'outlook/triage-inbox',
      'imap-smtp/triage-inbox',
    ]) {
      const doc = documentOf(slug);
      const max = maximumOf(doc, 'limit');
      expect(max, slug).toBeDefined();
      if (max === undefined) continue;
      const check = compileSchema(doc.inputs ?? {});
      // The repository, for the templates that read one.
      const base =
        maximumOf(doc, 'limit') !== undefined &&
        Array.isArray(doc.inputs?.required) &&
        doc.inputs.required.includes('owner')
          ? { owner: 'tale', repo: 'tale' }
          : {};
      expect(check({ ...base, limit: max }), slug).toBe(true);
      expect(check({ ...base, limit: max + 1 }), slug).toBe(false);
    }
  });

  it('reviews its largest batch of pull requests in one run and leaves the rest waiting', async () => {
    const doc = documentOf('github/review-pull-requests');
    const max = maximumOf(doc, 'limit') ?? 0;
    standIn('github.list_pull_requests_to_review', (input) =>
      queueOf(
        Array.from({ length: Number(input.limit) }, (_, at) => duePull(at + 1)),
        250,
      ),
    );
    const result = await execute(doc, {
      input: { owner: 'tale', repo: 'tale', limit: max },
    });
    expect(result.status, result.error?.message).toBe('success');
    expect(result.output).toMatchObject({ failed: [], waiting: 250 });
    expect(effectsOf(result, 'github.create_pull_request_review')).toHaveLength(
      max,
    );
  });

  it('triages its largest batch of changed issues in one run', async () => {
    const doc = documentOf('github/triage-issues');
    const max = maximumOf(doc, 'limit') ?? 0;
    standIn('github.list_issues', (input) => ({
      issues: Array.from({ length: Number(input.per_page) }, (_, at) =>
        issue(at + 1, `2026-10-14T08:${String(at % 60).padStart(2, '0')}:00Z`),
      ),
    }));
    const result = await execute(doc, {
      input: { owner: 'tale', repo: 'tale', limit: max },
    });
    expect(result.status, result.error?.message).toBe('success');
    expect(result.output).toMatchObject({ triaged: max, caughtUp: false });
  });

  it.each(['gmail', 'outlook', 'imap-smtp'])(
    '%s/triage-inbox judges and drafts for its largest batch in one run',
    async (provider) => {
      const doc = documentOf(`${provider}/triage-inbox`);
      const max = maximumOf(doc, 'limit') ?? 0;
      const ids = Array.from({ length: max }, (_, at) => `c${at + 1}`);
      standIn('conversation.list_untriaged', () => ({
        conversations: ids.map(waiting),
      }));
      const result = await execute(doc, {
        input: { limit: max },
        bench: {
          mocks: {
            triage: {
              summary: 'Every customer asks for a date.',
              items: ids.map((id) => verdict(id, 'reply')),
            },
          },
        },
      });
      expect(result.status, result.error?.message).toBe('success');
      expect(effectsOf(result, 'conversation.draft_reply')).toHaveLength(max);
    },
  );
});

describe('the pull request reviewer reviews each pull request once per new commit [AUTO-R73]', () => {
  it('answers only the pull requests the account has not reviewed at their newest commit, oldest change first', async () => {
    const queries: Array<Record<string, unknown>> = [];
    const pull = (
      number: number,
      over: Record<string, unknown> = {},
      reviewedAt: string[] = [],
    ) => ({
      number,
      title: `Change ${number}`,
      url: `https://github.com/tale/tale/pull/${number}`,
      isDraft: false,
      headRefOid: `head-${number}`,
      updatedAt: '2026-10-14T09:00:00Z',
      author: { login: 'ada' },
      reviews: { nodes: reviewedAt.map((oid) => ({ commit: { oid } })) },
      ...over,
    });
    const ctx = {
      http: {
        post: async (_url: string, options: { body: string }) => {
          const body = JSON.parse(options.body) as {
            query: string;
            variables: Record<string, unknown>;
          };
          queries.push(body.variables);
          if (!body.query.includes('repository')) {
            return reply(200, { data: { viewer: { login: 'tale-reviewer' } } });
          }
          return reply(200, {
            data: {
              repository: {
                pullRequests: {
                  totalCount: 6,
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    pull(1, { isDraft: true }),
                    pull(2, { author: { login: 'tale-reviewer' } }),
                    // Reviewed at an older commit: a push made it due again.
                    pull(3, {}, ['head-3-before-the-push']),
                    // Reviewed at its newest commit: not again.
                    pull(4, {}, ['head-4']),
                    pull(5, { updatedAt: '2026-10-14T07:00:00Z' }),
                    pull(6, { updatedAt: '2026-10-14T08:00:00Z' }),
                  ],
                },
              },
            },
          });
        },
      },
    };
    const answer = await inProcessLiveRunner().runBody(
      liveBodyOf('github', 'list_pull_requests_to_review'),
      { input: { owner: 'tale', repo: 'tale', limit: 2 }, ctx },
      { timeoutMs: 2_000 },
      { async: true },
    );
    expect(answer).toMatchObject({
      viewer: 'tale-reviewer',
      open: 6,
      scanned: 6,
      pulls: [
        { number: 5, headSha: 'head-5' },
        { number: 6, headSha: 'head-6' },
      ],
      waiting: 1,
      skipped: { drafts: 1, own: 1, reviewed: 1 },
    });
    // The reviews it reads are the account's own.
    expect(queries[1]).toMatchObject({ viewer: 'tale-reviewer' });
  });

  it('pins each review to the commit it read', async () => {
    standIn('github.list_pull_requests_to_review', () =>
      queueOf([duePull(7), duePull(8)]),
    );
    const result = await execute(documentOf('github/review-pull-requests'), {
      input: { owner: 'tale', repo: 'tale' },
    });
    expect(
      effectsOf(result, 'github.create_pull_request_review').map((post) => [
        post.pull_number,
        post.commit_id,
        post.event,
      ]),
    ).toEqual([
      [7, 'sha-7', 'COMMENT'],
      [8, 'sha-8', 'COMMENT'],
    ]);
  });

  it('leaves a pull request whose diff cannot be read for the next run, and reviews the others', async () => {
    standIn('github.list_pull_requests_to_review', () =>
      queueOf([duePull(1), duePull(2), duePull(3)]),
    );
    standIn('github.get_pull_request_diff', (input) => {
      if (input.pull_number === 2) {
        throw new Error('GitHub get_pull_request_diff failed (502)');
      }
      return { diff: '+ a line', size: 8, truncated: false, tooLarge: false };
    });
    const result = await execute(documentOf('github/review-pull-requests'), {
      input: { owner: 'tale', repo: 'tale' },
    });
    expect(result.status, result.error?.message).toBe('success');
    expect(result.output).toMatchObject({ reviewed: [1, 3], failed: [2] });
  });

  it('cuts a diff at its bound, and answers one GitHub will not render as too large', async () => {
    const body = liveBodyOf('github', 'get_pull_request_diff');
    const run = async (status: number, text: string) =>
      await inProcessLiveRunner().runBody(
        body,
        {
          input: { owner: 'tale', repo: 'tale', pull_number: 1, maxChars: 10 },
          ctx: { http: { get: async () => reply(status, text) } },
        },
        { timeoutMs: 2_000 },
        { async: true },
      );
    expect(await run(200, 'diff --git a/x b/x')).toEqual({
      diff: 'diff --git',
      size: 18,
      truncated: true,
      tooLarge: false,
    });
    expect(await run(406, 'too_large')).toEqual({
      diff: '',
      size: null,
      truncated: true,
      tooLarge: true,
    });
  });
});

describe('inbox triage marks a thread judged only once its draft waits in it [AUTO-R74]', () => {
  it('stamps the threads it can stand by, and leaves one whose draft failed for the next run', async () => {
    standIn('conversation.list_untriaged', () => ({
      conversations: ['c1', 'c2', 'c3'].map(waiting),
    }));
    standIn('conversation.draft_reply', (input) => {
      if (input.conversationId === 'c2') {
        throw new Error('the conversation was closed meanwhile');
      }
      return {
        approvalId: `apr_${String(input.conversationId)}`,
        created: true,
      };
    });
    const result = await execute(documentOf('gmail/triage-inbox'), {
      input: { limit: 3 },
      bench: {
        mocks: {
          triage: {
            summary: 'Two questions and a receipt.',
            items: [
              verdict('c1', 'reply'),
              verdict('c2', 'reply'),
              verdict('c3', 'no_reply'),
            ],
          },
        },
      },
    });
    expect(result.status, result.error?.message).toBe('success');
    const [record] = effectsOf(result, 'conversation.record_triage');
    expect(record?.verdicts).toEqual([
      verdict('c1', 'reply'),
      verdict('c3', 'no_reply'),
    ]);
    expect(result.output).toMatchObject({
      drafted: [{ conversationId: 'c1', approvalId: 'apr_c1', created: true }],
      unstamped: ['c2'],
    });
  });

  it('stamps nothing when no draft could be left, so the whole pass comes back', async () => {
    standIn('conversation.list_untriaged', () => ({
      conversations: ['c1'].map(waiting),
    }));
    standIn('conversation.draft_reply', () => {
      throw new Error('the conversation was closed meanwhile');
    });
    const result = await execute(documentOf('gmail/triage-inbox'), {
      input: { limit: 1 },
      bench: {
        mocks: {
          triage: { summary: 'One question.', items: [verdict('c1', 'reply')] },
        },
      },
    });
    expect(result.status).toBe('error');
    expect(result.error?.nodeId).toBe('propose');
    expect(effectsOf(result, 'conversation.record_triage')).toEqual([]);
  });
});

describe('the task digest lists each new task once, however its schedule moved [AUTO-R75]', () => {
  /** A project's tasks as `task.list` answers them: newest or oldest first,
   * in a window, behind a place, `next` when more match. */
  function project(tasks: Array<{ taskId: string; createdAt: number }>) {
    return (input: Record<string, unknown>) => {
      const since = Number(input.createdSince ?? 0);
      const before = Number(input.createdBefore ?? Number.MAX_SAFE_INTEGER);
      const after =
        typeof input.after === 'string' && input.after !== ''
          ? input.after.split(':')
          : null;
      const place = (task: { taskId: string; createdAt: number }) =>
        after === null ||
        task.createdAt > Number(after[0]) ||
        (task.createdAt === Number(after[0]) && task.taskId > (after[1] ?? ''));
      const matching = tasks
        .filter(
          (task) =>
            task.createdAt >= since && task.createdAt < before && place(task),
        )
        .toSorted((a, b) =>
          input.order === 'oldest'
            ? a.createdAt - b.createdAt || a.taskId.localeCompare(b.taskId)
            : b.createdAt - a.createdAt || b.taskId.localeCompare(a.taskId),
        );
      const limit = Number(input.limit ?? 50);
      const listed = matching.slice(0, limit);
      const last = listed.at(-1);
      const hasMore = matching.length > limit;
      return {
        tasks: listed.map((task, at) => ({
          taskId: task.taskId,
          number: at + 1,
          title: task.taskId,
          status: 'todo',
          priority: null,
          assignee: null,
          dueDate: null,
          createdAt: new Date(task.createdAt).toISOString(),
          url: `/tasks/${task.taskId}`,
        })),
        hasMore,
        next:
          input.order === 'oldest' && hasMore && last !== undefined
            ? `${last.createdAt}:${last.taskId}`
            : null,
      };
    };
  }

  /** One digest run: the place it read, and the place it saved. */
  async function digestAt(firedAt: number, saved: unknown) {
    standIn('automation.read_position', () => ({
      value: saved,
      revision: saved === null ? '0' : '1',
    }));
    const result = await execute(documentOf('task-digest'), {
      input: { trigger: 'schedule', firedAt },
    });
    expect(result.status, result.error?.message).toBe('success');
    const [save] = effectsOf(result, 'automation.save_position');
    return { result, place: save?.value ?? null };
  }

  it('lists what was created since the last digest that was sent, up to its own occurrence', async () => {
    const { result, place } = await digestAt(FIRED, { until: FIRED - 3 * DAY });
    expect(inputOfStep(result, 'tasks')).toMatchObject({
      order: 'oldest',
      createdSince: FIRED - 3 * DAY,
      createdBefore: FIRED,
    });
    expect(place).toEqual({ until: FIRED });
  });

  it('starts the next digest exactly where this one ended, and the first one day back', async () => {
    const first = await digestAt(FIRED, null);
    expect(inputOfStep(first.result, 'tasks')).toMatchObject({
      createdSince: FIRED - DAY,
      createdBefore: FIRED,
    });
    // Moved to the afternoon: the next occurrence is 31 hours later.
    const later = FIRED + 31 * 60 * 60 * 1000;
    const next = await digestAt(later, first.place);
    expect(inputOfStep(next.result, 'tasks')).toMatchObject({
      createdSince: FIRED,
      createdBefore: later,
    });
  });

  it('lists every task of a catch-up holding more than one digest, each once', async () => {
    // Three days down: 130 tasks, two of them in one millisecond.
    const tasks = Array.from({ length: 130 }, (_, at) => ({
      taskId: `t${String(at).padStart(3, '0')}`,
      createdAt: FIRED - 3 * DAY + (at === 61 ? 60 * 1000 : at * 1000),
    }));
    standIn('task.list', project(tasks));
    const listed: string[] = [];
    let place: unknown = { until: FIRED - 3 * DAY };
    for (let day = 0; day < 5; day++) {
      const run = await digestAt(FIRED + day * DAY, place);
      const read = run.result.trace.find((entry) => entry.node === 'tasks');
      const output =
        typeof read?.output === 'object' && read.output !== null
          ? (read.output as { tasks?: Array<{ taskId: string }> })
          : {};
      listed.push(...(output.tasks ?? []).map((task) => task.taskId));
      place = run.place;
    }
    expect(listed).toHaveLength(130);
    expect(new Set(listed).size).toBe(130);
    expect(listed).toEqual(
      tasks
        .toSorted(
          (a, b) =>
            a.createdAt - b.createdAt || a.taskId.localeCompare(b.taskId),
        )
        .map((task) => task.taskId),
    );
  });
});

describe('a webhook delivery sent again updates the task it made [AUTO-R76]', () => {
  const keyOf = async (
    payload: Record<string, unknown>,
    doc = documentOf('webhook-create-task'),
  ) => {
    const result = await execute(doc, {
      input: { trigger: 'webhook', payload },
    });
    expect(result.status, result.error?.message).toBe('success');
    return effectsOf(result, 'task.upsert')[0]?.externalId;
  };

  it('keys a delivery by its id, or by its whole body whatever the order of its keys', async () => {
    expect(await keyOf({ id: 'evt-1', title: 'Server down' })).toBe('evt-1');
    expect(await keyOf({ id: 42, title: 'Server down' })).toBe('42');
    const body = await keyOf({
      title: 'Server down',
      description: 'Disk full.',
    });
    expect(body).toMatch(/^body:[0-9a-f]{16}$/);
    expect(
      await keyOf({ description: 'Disk full.', title: 'Server down' }),
    ).toBe(body);
    expect(
      await keyOf({ title: 'Server down', description: 'Disk full on web-2.' }),
    ).not.toBe(body);
  });

  it('reads the nested field the creator names', async () => {
    const doc = withInput(documentOf('webhook-create-task'), 'key', {
      field: 'alert.id',
    });
    expect(
      await keyOf(
        { alert: { id: 'a-9', state: 'firing' }, title: 'Disk' },
        doc,
      ),
    ).toBe('a-9');
  });
});

describe('issue triage scores an issue again only once it changed [AUTO-R77]', () => {
  /** The place a repository's last run saved. */
  const saved = (updatedAt: string, numbers: number[]) => () => ({
    value: { updatedAt, numbers },
    revision: '3',
  });

  it('reads on from the last run, and skips what it triaged in that very second', async () => {
    standIn('automation.read_position', saved('2026-10-14T09:00:00Z', [12]));
    standIn('github.list_issues', () => ({
      issues: [
        issue(12, '2026-10-14T09:00:00Z'),
        issue(14, '2026-10-14T09:00:00Z'),
        issue(15, '2026-10-14T10:00:00Z'),
      ],
    }));
    const result = await execute(documentOf('github/triage-issues'), {
      input: { owner: 'tale', repo: 'tale' },
    });
    expect(result.status, result.error?.message).toBe('success');
    expect(inputOfStep(result, 'issues')).toMatchObject({
      since: '2026-10-14T09:00:00Z',
      direction: 'asc',
      sort: 'updated',
    });
    expect(result.output).toMatchObject({ triaged: 2 });
    expect(effectsOf(result, 'automation.save_position')).toEqual([
      {
        key: 'tale/tale',
        value: { updatedAt: '2026-10-14T10:00:00Z', numbers: [15] },
        revision: '3',
      },
    ]);
  });

  it('keeps a place per repository, so a run for another one moves nothing of it', async () => {
    standIn('automation.read_position', () => ({ value: null, revision: '0' }));
    standIn('github.list_issues', () => ({ issues: [] }));
    const result = await execute(documentOf('github/triage-issues'), {
      input: { owner: 'Tale', repo: 'Website' },
    });
    expect(inputOfStep(result, 'place')).toEqual({ key: 'tale/website' });
    // A repository it never read starts with its newest changes.
    expect(inputOfStep(result, 'issues')).toMatchObject({
      since: '',
      direction: 'desc',
    });
    expect(effectsOf(result, 'automation.save_position')[0]).toMatchObject({
      key: 'tale/website',
    });
  });
});
