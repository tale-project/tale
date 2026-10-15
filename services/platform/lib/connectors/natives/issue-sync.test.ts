import type { TaskExternalIssue } from '@tale/shared/schemas/task-external-issue';
import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../errors';
import {
  IssueCursorError,
  IssueSourceHttpError,
  type ImportedIssue,
} from './issue-import';
import {
  failedSources,
  issueSyncFailure,
  issueSyncFails,
  issueSyncInputSchema,
  syncIssueSources,
  type IssueSourceReceipt,
  type IssueSyncDeps,
  type IssueWrite,
  type LinkedIssue,
  type SyncPositionKey,
} from './issue-sync';

/**
 * The sync over fakes: a tracker per connector that answers from a script,
 * a position store with the real one's revisions and attempts, and a task
 * table keyed by source identity. What the database itself guarantees (the
 * locks, the compare-and-set under concurrency) is proven against Postgres
 * in `backend/domains/tasks/issue-sync.integration.ts`.
 */

const NOW = Date.parse('2026-10-14T18:00:00Z');

function snapshot(
  id: string,
  overrides: Partial<TaskExternalIssue> = {},
): TaskExternalIssue {
  return {
    id,
    title: `Issue ${id}`,
    description: 'Details',
    url: `https://github.com/example/web/issues/${id}`,
    state: 'open',
    syncedAt: NOW,
    repositoryId: 10,
    number: Number(id),
    ...overrides,
  };
}

function issue(
  id: string,
  overrides: Partial<TaskExternalIssue> = {},
): ImportedIssue {
  const source = snapshot(id, overrides);
  return {
    externalSystem: 'github',
    externalId: `example/web#${id}`,
    externalUrl: source.url,
    title: source.title,
    description: source.description,
    externalIssue: source,
  };
}

interface FakePosition {
  cursor: string | null;
  revision: number;
  batch: number;
  attempts: number;
  retryAfter: number | null;
}

type Script = (input: Record<string, unknown>) => unknown;

function fakes(
  options: {
    list?: Record<string, Script>;
    refresh?: Record<string, Script>;
    tasks?: Map<string, TaskExternalIssue>;
    refuse?: Set<string>;
    signal?: AbortSignal;
    linked?: LinkedIssue[];
  } = {},
) {
  let revisions = 1;
  const positions = new Map<string, FakePosition>();
  const tasks = options.tasks ?? new Map<string, TaskExternalIssue>();
  const calls: Array<{
    connector: string;
    action: string;
    input: Record<string, unknown>;
    credential?: string;
  }> = [];
  const failures: string[] = [];
  const writes: string[] = [];
  const labelled: Array<{ externalId: string; labels?: string[] }> = [];
  const queries: Array<Parameters<IssueSyncDeps['linked']>[0]> = [];
  const name = (key: SyncPositionKey) => `${key.externalSystem}:${key.source}`;
  const row = (key: SyncPositionKey): FakePosition => {
    const found = positions.get(name(key));
    if (found !== undefined) return found;
    const created: FakePosition = {
      cursor: null,
      revision: revisions++,
      batch: 0,
      attempts: 0,
      retryAfter: null,
    };
    positions.set(name(key), created);
    return created;
  };
  const deps: IssueSyncDeps = {
    call: async (args) => {
      calls.push(args);
      // A script answers one action (`github.list_import_alerts`), or every
      // listing or every refresh of its connector.
      const scripts = args.action.startsWith('list_')
        ? options.list
        : options.refresh;
      const script =
        scripts?.[`${args.connector}.${args.action}`] ??
        scripts?.[args.connector];
      if (script === undefined) {
        throw new Error(`no script for ${args.connector}.${args.action}`);
      }
      return script(args.input);
    },
    positions: {
      read: async (key) => {
        const position = row(key);
        if (position.cursor !== null && position.attempts >= 3) {
          Object.assign(position, {
            cursor: null,
            batch: 0,
            attempts: 0,
            revision: revisions++,
          });
          return {
            cursor: '',
            revision: String(position.revision),
            batch: 1,
            resumed: false,
            restarted: true,
            retryAfter: position.retryAfter,
          };
        }
        return {
          cursor: position.cursor ?? '',
          revision: String(position.revision),
          batch: position.batch + 1,
          resumed: position.cursor !== null,
          restarted: false,
          retryAfter:
            position.retryAfter !== null && position.retryAfter > NOW
              ? position.retryAfter
              : null,
        };
      },
      save: async (key, args) => {
        const position = row(key);
        if (String(position.revision) !== args.revision) {
          return {
            saved: false,
            drained: false,
            batch: position.batch,
            conflict: true,
            revision: String(position.revision),
          };
        }
        const batch = position.batch + 1;
        Object.assign(position, {
          cursor: args.next === '' ? null : args.next,
          batch: args.next === '' ? 0 : batch,
          attempts: 0,
          revision: revisions++,
          retryAfter: args.retryAfter ?? null,
        });
        return {
          saved: true,
          drained: args.next === '',
          batch,
          conflict: false,
          revision: String(position.revision),
        };
      },
      fail: async (key, args) => {
        const position = row(key);
        failures.push(`${name(key)}@${args.revision}`);
        if (String(position.revision) === args.revision) position.attempts++;
      },
      restart: async (key, args) => {
        const position = row(key);
        if (String(position.revision) !== args.revision) {
          return { restarted: false, revision: String(position.revision) };
        }
        Object.assign(position, {
          cursor: null,
          batch: 0,
          attempts: 0,
          revision: revisions++,
        });
        return { restarted: true, revision: String(position.revision) };
      },
      wait: async (key, args) => {
        const position = row(key);
        position.retryAfter = Math.max(
          position.retryAfter ?? 0,
          args.retryAfter,
        );
      },
    },
    linked: async (query) => {
      queries.push(query);
      return {
        issues: (options.linked ?? []).slice(0, query.limit),
        hasMore: false,
      };
    },
    write: async (written, writeOptions): Promise<IssueWrite> => {
      writes.push(written.externalId);
      labelled.push({
        externalId: written.externalId,
        ...(writeOptions?.labels !== undefined && {
          labels: writeOptions.labels,
        }),
      });
      if (options.refuse?.has(written.externalId)) {
        return { ok: false, reason: 'TASK_EXTERNAL_REF_INVALID' };
      }
      const previous = tasks.get(written.externalIssue.id) ?? null;
      tasks.set(written.externalIssue.id, written.externalIssue);
      return {
        ok: true,
        taskId: `task-${written.externalIssue.id}`,
        created: previous === null,
        previous,
      };
    },
    now: () => NOW,
    ...(options.signal !== undefined && { signal: options.signal }),
  };
  return {
    deps,
    positions,
    tasks,
    calls,
    failures,
    writes,
    labelled,
    queries,
    row,
  };
}

/** A listing that answers the given issues and next cursor. */
function listing(
  issues: ImportedIssue[],
  nextCursor: string | null,
  extra: Record<string, unknown> = { repositoryId: 10 },
): Script {
  return () => ({
    issues,
    truncated: nextCursor !== null,
    nextCursor,
    ...extra,
  });
}

function input(sources: unknown[], more: Record<string, unknown> = {}) {
  return issueSyncInputSchema.parse({
    projectId: 'project-1',
    sources,
    ...more,
  });
}

const web = { kind: 'github', owner: 'example', repo: 'web' };
const glitch = { kind: 'glitchtip', organization: 'example', project: 'web' };
const glitchListing = listing([], null, {
  sourceOrigin: 'https://glitchtip.example.com',
  sourceProjectId: '20',
});

describe('task.sync_issues positions', () => {
  it('reads each source from where its last saved batch stopped, and drains into a new pass [TASK-R57]', async () => {
    const pages = [
      { issues: [issue('1'), issue('2')], next: 'page-2' },
      { issues: [issue('3')], next: null },
      { issues: [issue('1')], next: 'page-2' },
    ];
    const cursors: unknown[] = [];
    const { deps, tasks } = fakes({
      list: {
        github: (listInput) => {
          cursors.push(listInput.cursor);
          const page = pages.shift();
          return {
            issues: page?.issues ?? [],
            truncated: page?.next !== null,
            nextCursor: page?.next ?? null,
            repositoryId: 10,
          };
        },
        glitchtip: glitchListing,
      },
    });
    const first = await syncIssueSources(deps, input([web, glitch]));
    expect(first.sources[0]).toMatchObject({
      kind: 'github',
      source: 'example/web',
      ok: true,
      batch: 1,
      resumed: false,
      saved: true,
      drained: false,
      discovered: 2,
      created: 2,
    });
    expect(first.sources[1]).toMatchObject({
      kind: 'glitchtip',
      source: 'example/web',
      ok: true,
      drained: true,
    });
    const second = await syncIssueSources(deps, input([web, glitch]));
    expect(second.sources[0]).toMatchObject({
      batch: 2,
      resumed: true,
      drained: true,
      created: 1,
    });
    // After the drain the next run starts the listing over, and an issue
    // read again keeps its one task.
    const third = await syncIssueSources(deps, input([web, glitch]));
    expect(third.sources[0]).toMatchObject({
      batch: 1,
      resumed: false,
      created: 0,
      unchanged: 1,
    });
    expect(cursors).toEqual([undefined, 'page-2', undefined]);
    expect([...tasks.keys()].sort()).toEqual(['1', '2', '3']);
  });

  it('keeps the plain owner/repo position when no filter is set, as a hand-built chain names it [TASK-R57]', async () => {
    const { deps, positions } = fakes({
      list: { github: listing([], null), glitchtip: glitchListing },
    });
    await syncIssueSources(
      deps,
      input([
        { ...web, labels: ' , ' },
        { ...glitch, query: ' is:unresolved ' },
      ]),
    );
    expect([...positions.keys()]).toEqual([
      'github:example/web',
      'glitchtip:example/web',
    ]);
  });

  it('keeps a position of its own for each filter, so two syncs of one repository never reset each other [TASK-R57]', async () => {
    // The tracker's cursor remembers the filter it was read under, as the
    // importers' cursors do: read under another filter, it is stale.
    const filtered = (listInput: Record<string, unknown>) => {
      const labels =
        typeof listInput.labels === 'string' ? listInput.labels : '';
      const at =
        typeof listInput.cursor === 'string'
          ? (JSON.parse(listInput.cursor) as { offset: number; labels: string })
          : { offset: 0, labels };
      if (at.labels !== labels) {
        throw new IssueCursorError(
          'The issue cursor belongs to another source or filter. Start a new import.',
        );
      }
      const end = at.offset + 1;
      return {
        issues: [issue(String(end))],
        truncated: end < 3,
        nextCursor: end < 3 ? JSON.stringify({ offset: end, labels }) : null,
        repositoryId: 10,
      };
    };
    const harness = fakes({ list: { github: filtered } });
    const receipts: IssueSourceReceipt[] = [];
    for (let run = 0; run < 2; run++) {
      for (const labels of ['bug', 'ui']) {
        const result = await syncIssueSources(
          harness.deps,
          input([{ ...web, labels }]),
        );
        receipts.push(...result.sources);
      }
    }
    expect(
      receipts.map((receipt) => [
        receipt.source,
        receipt.filter,
        receipt.batch,
        receipt.resumed,
        receipt.restarted,
      ]),
    ).toEqual([
      ['example/web', 'bug', 1, false, false],
      ['example/web', 'ui', 1, false, false],
      ['example/web', 'bug', 2, true, false],
      ['example/web', 'ui', 2, true, false],
    ]);
    expect(harness.positions.size).toBe(2);
  });

  it('reads one label filter however its labels are written [TASK-R57]', async () => {
    const harness = fakes({ list: { github: listing([], null) } });
    await syncIssueSources(harness.deps, input([{ ...web, labels: 'bug,ui' }]));
    await syncIssueSources(
      harness.deps,
      input([{ ...web, labels: ' ui , bug,bug,' }]),
    );
    expect(harness.positions.size).toBe(1);
    expect(harness.calls.map((call) => call.input.labels)).toEqual([
      'bug,ui',
      'bug,ui',
    ]);
  });

  it('takes one repository twice in a list only under two filters', () => {
    expect(
      issueSyncInputSchema.safeParse({
        projectId: 'project-1',
        sources: [
          { ...web, labels: 'bug' },
          { ...web, labels: 'ui' },
        ],
      }).success,
    ).toBe(true);
    expect(
      issueSyncInputSchema.safeParse({
        projectId: 'project-1',
        sources: [
          { ...web, labels: 'bug' },
          { ...web, labels: ' bug ' },
        ],
      }).success,
    ).toBe(false);
  });

  it('reads with the named credential and a normalized label filter [TASK-R57]', async () => {
    const { deps, calls } = fakes({
      list: { github: listing([], null) },
    });
    await syncIssueSources(
      deps,
      input([{ ...web, labels: ' bug , ui ,', credential: 'GitHub work' }]),
    );
    expect(calls[0]).toEqual({
      connector: 'github',
      action: 'list_import_issues',
      input: { owner: 'example', repo: 'web', labels: 'bug,ui', limit: 100 },
      credential: 'GitHub work',
    });
  });

  it('reads with the default connection when the source names an empty one [TASK-R57]', async () => {
    const { deps, calls } = fakes({ list: { github: listing([], null) } });
    await syncIssueSources(deps, input([{ ...web, credential: '' }]));
    expect(calls[0]).not.toHaveProperty('credential');
  });

  it('refuses a list that names one source twice', () => {
    expect(
      issueSyncInputSchema.safeParse({
        projectId: 'project-1',
        sources: [web, { ...web, owner: 'Example' }],
      }).success,
    ).toBe(false);
  });

  it('saves nothing over a position another run moved first [TASK-R58]', async () => {
    const harness = fakes({
      list: { github: listing([issue('1')], 'page-2') },
    });
    // Another run saves between this run's read and its save.
    const read = harness.deps.positions.read.bind(harness.deps.positions);
    harness.deps.positions.read = async (key) => {
      const position = await read(key);
      await harness.deps.positions.save(key, {
        revision: position.revision,
        next: 'other',
      });
      return position;
    };
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(result.sources[0]).toMatchObject({
      ok: true,
      saved: false,
      conflict: true,
      created: 1,
    });
    expect(
      harness.row({ externalSystem: 'github', source: 'example/web' }),
    ).toMatchObject({ cursor: 'other', batch: 1 });
  });

  it('starts the pass over at once when the stored cursor belongs to another filter [TASK-R59]', async () => {
    const cursors: unknown[] = [];
    const harness = fakes({
      list: {
        github: (listInput) => {
          cursors.push(listInput.cursor);
          if (listInput.cursor === 'old-filter') {
            throw new IssueCursorError(
              'The issue cursor belongs to another source or filter. Start a new import.',
            );
          }
          return {
            issues: [issue('1')],
            truncated: false,
            nextCursor: null,
            repositoryId: 10,
          };
        },
      },
    });
    Object.assign(
      harness.row({ externalSystem: 'github', source: 'example/web' }),
      { cursor: 'old-filter', batch: 4 },
    );
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(cursors).toEqual(['old-filter', undefined]);
    expect(result.sources[0]).toMatchObject({
      ok: true,
      restarted: true,
      resumed: false,
      batch: 1,
      saved: true,
      drained: true,
      created: 1,
    });
    expect(harness.failures).toEqual([]);
  });

  it('counts a refused batch against its position, which starts over after three [TASK-R59]', async () => {
    let fail = true;
    const harness = fakes({
      list: {
        github: (listInput) => {
          if (fail) {
            throw new IssueSourceHttpError(
              'GitHub issue sync failed (HTTP 500).',
              {
                status: 500,
                retryAfter: null,
                action: 'github.list_import_issues',
              },
            );
          }
          return {
            issues: [],
            truncated: false,
            nextCursor: null,
            repositoryId: 10,
            cursorSeen: listInput.cursor ?? '',
          };
        },
      },
    });
    Object.assign(
      harness.row({ externalSystem: 'github', source: 'example/web' }),
      { cursor: 'page-7', batch: 6 },
    );
    for (let run = 0; run < 3; run++) {
      const result = await syncIssueSources(harness.deps, input([web]));
      expect(result.sources[0]).toMatchObject({
        ok: false,
        error: 'unavailable',
        batch: 7,
        saved: false,
      });
    }
    expect(harness.failures).toHaveLength(3);
    fail = false;
    const fourth = await syncIssueSources(harness.deps, input([web]));
    expect(fourth.sources[0]).toMatchObject({
      ok: true,
      restarted: true,
      batch: 1,
    });
    expect(harness.calls.at(-1)?.input).not.toHaveProperty('cursor');
  });
});

describe('task.sync_issues sources', () => {
  const pulls = {
    ...web,
    type: 'pulls',
    author: 'renovate[bot]',
  };
  const forgejo = { kind: 'forgejo', owner: 'example', repo: 'web' };
  const security = {
    kind: 'github-security',
    owner: 'example',
    repo: 'web',
    alerts: ['dependabot', 'code-scanning'],
    minSeverity: 'high',
    tools: ['Trivy', ' CodeQL', 'Trivy'],
  };
  const forgejoOrigin = 'https://git.example.org';
  const forgejoListing = listing([], null, {
    repositoryId: 30,
    sourceOrigin: forgejoOrigin,
  });
  const alertListing = listing([], null, {
    repositoryId: 10,
    repository: 'example/web',
  });
  const linkedTask = (id: string): LinkedIssue => ({
    taskId: `task-${id}`,
    externalId: `example/web#${id}`,
    externalIssue: snapshot(id, { syncedAt: NOW - 1000 }),
  });

  it('reads a repository’s pull requests apart from its issues, each pass and its tasks its own [TASK-R63]', async () => {
    const harness = fakes({
      list: { github: listing([], null) },
      refresh: { github: () => ({ issues: [], failed: [], notRead: 0 }) },
      linked: [linkedTask('1')],
    });
    await syncIssueSources(harness.deps, input([web, pulls]));
    expect(harness.calls.map((call) => call.input)).toEqual([
      { owner: 'example', repo: 'web', limit: 100 },
      expect.objectContaining({ issues: expect.any(Array), repositoryId: 10 }),
      {
        owner: 'example',
        repo: 'web',
        type: 'pulls',
        author: 'renovate[bot]',
        limit: 100,
      },
      expect.objectContaining({ issues: expect.any(Array), repositoryId: 10 }),
    ]);
    // The issues keep the plain position a hand-built chain names; the
    // pull requests keep one of their own.
    const keys = [...harness.positions.keys()];
    expect(keys[0]).toBe('github:example/web');
    expect(keys[1]).toMatch(/^github:example\/web~[0-9a-f]{12}$/);
    // Each refresh reads only the tasks of its own kind.
    expect(harness.queries.map((query) => query.itemKind)).toEqual([
      'issues',
      'pulls',
    ]);
  });

  it('keeps one position for one author however it is written [TASK-R63]', async () => {
    const harness = fakes({ list: { github: listing([], null) } });
    await syncIssueSources(harness.deps, input([pulls]));
    await syncIssueSources(
      harness.deps,
      input([{ ...pulls, author: ' Renovate[bot] ' }]),
    );
    expect(harness.positions.size).toBe(1);
    expect(harness.calls.map((call) => call.input.author)).toEqual([
      'renovate[bot]',
      'renovate[bot]',
    ]);
  });

  it('refuses an author that is no login', () => {
    for (const author of ['a b', 'renovate[app]', 'x'.repeat(101)]) {
      expect(
        issueSyncInputSchema.safeParse({
          projectId: 'project-1',
          sources: [{ ...pulls, author }],
        }).success,
      ).toBe(false);
    }
  });

  it('reads a Forgejo repository through its connection, and finds its tasks by instance and repository [TASK-R65]', async () => {
    const harness = fakes({
      list: { forgejo: forgejoListing },
      refresh: { forgejo: () => ({ issues: [], failed: [], notRead: 0 }) },
      linked: [linkedTask('1')],
    });
    const result = await syncIssueSources(
      harness.deps,
      input([{ ...forgejo, type: 'pulls', credential: 'Forgejo ops' }]),
    );
    expect(result.sources[0]).toMatchObject({
      kind: 'forgejo',
      source: 'example/web',
      ok: true,
    });
    expect(harness.calls[0]).toEqual({
      connector: 'forgejo',
      action: 'list_import_issues',
      input: { owner: 'example', repo: 'web', type: 'pulls', limit: 100 },
      credential: 'Forgejo ops',
    });
    expect(harness.queries[0]).toMatchObject({
      externalSystem: 'forgejo',
      repositoryId: 30,
      sourceOrigin: forgejoOrigin,
      itemKind: 'pulls',
    });
    expect(harness.calls[1]).toMatchObject({
      connector: 'forgejo',
      action: 'refresh_import_issues',
      input: { repositoryId: 30, report: true },
    });
    expect([...harness.positions.keys()][0]).toMatch(
      /^forgejo:example\/web~[0-9a-f]{12}$/,
    );
  });

  it('fails a Forgejo source whose listing names no instance, before any task is read [TASK-R65]', async () => {
    const harness = fakes({
      list: { forgejo: listing([], null, { repositoryId: 30 }) },
    });
    const result = await syncIssueSources(harness.deps, input([forgejo]));
    expect(result.sources[0]).toMatchObject({ ok: false });
    expect(harness.queries).toEqual([]);
  });

  it('keeps one GitHub repository’s issues and its Forgejo twin apart', () => {
    expect(
      issueSyncInputSchema.safeParse({
        projectId: 'project-1',
        sources: [web, forgejo],
      }).success,
    ).toBe(true);
  });

  it('reads a repository’s security alerts through their own actions, under a position of their own [TASK-R64]', async () => {
    const harness = fakes({
      list: { 'github.list_import_alerts': alertListing },
      refresh: {
        'github.refresh_import_alerts': () => ({
          issues: [],
          failed: [],
          notRead: 0,
        }),
      },
      linked: [linkedTask('1')],
    });
    const result = await syncIssueSources(harness.deps, input([security]));
    expect(result.sources[0]).toMatchObject({
      kind: 'github-security',
      source: 'example/web',
      ok: true,
    });
    expect(harness.calls[0]).toEqual({
      connector: 'github',
      action: 'list_import_alerts',
      input: {
        owner: 'example',
        repo: 'web',
        alerts: ['code-scanning', 'dependabot'],
        minSeverity: 'high',
        tools: ['CodeQL', 'Trivy'],
        limit: 100,
      },
    });
    expect(harness.queries[0]).toEqual({
      externalSystem: 'github-security',
      repositoryId: 10,
      limit: 50,
    });
    expect(harness.calls[1]).toMatchObject({
      connector: 'github',
      action: 'refresh_import_alerts',
      input: { repositoryId: 10, repository: 'example/web', report: true },
    });
    expect([...harness.positions.keys()][0]).toMatch(
      /^github-security:example\/web~[0-9a-f]{12}$/,
    );
  });

  it('reads one alert filter however its kinds and tools are written [TASK-R64]', async () => {
    const harness = fakes({
      list: { 'github.list_import_alerts': alertListing },
    });
    await syncIssueSources(harness.deps, input([security]));
    await syncIssueSources(
      harness.deps,
      input([
        {
          ...security,
          alerts: ['code-scanning', 'dependabot'],
          tools: ['CodeQL', 'Trivy'],
        },
      ]),
    );
    expect(harness.positions.size).toBe(1);
    // A security source and the repository's issues are two trackers.
    expect(
      issueSyncInputSchema.safeParse({
        projectId: 'project-1',
        sources: [web, security],
      }).success,
    ).toBe(true);
  });

  it('refuses a security source that names no kind of alert, or one twice', () => {
    for (const alerts of [[], ['dependabot', 'dependabot'], ['issues']]) {
      expect(
        issueSyncInputSchema.safeParse({
          projectId: 'project-1',
          sources: [{ ...security, alerts }],
        }).success,
      ).toBe(false);
    }
  });

  it('names the security alert listing when every security source failed [TASK-R54]', async () => {
    const harness = fakes({
      list: {
        'github.list_import_alerts': () => {
          throw new IssueSourceHttpError(
            'GitHub issue sync failed (HTTP 403).',
            {
              status: 403,
              retryAfter: null,
              action: 'github.list_import_alerts',
            },
          );
        },
      },
    });
    const result = await syncIssueSources(harness.deps, input([security]));
    expect(issueSyncFailure(result.sources)).toEqual({
      reason: 'CONNECTOR_AUTH',
      params: {
        connector: 'github',
        action: 'github.list_import_alerts',
        status: 403,
      },
    });
  });
});

describe('task.sync_issues task labels', () => {
  it('gives a task its source creates the source’s labels, and the other sources’ tasks none [TASK-R62]', async () => {
    const harness = fakes({
      list: {
        github: listing([issue('1')], null),
        glitchtip: listing(
          [
            {
              ...issue('2'),
              externalSystem: 'glitchtip',
              externalId: 'https://glitchtip.example.com/example/web#2',
            },
          ],
          null,
          {
            sourceOrigin: 'https://glitchtip.example.com',
            sourceProjectId: '20',
          },
        ),
      },
    });
    await syncIssueSources(
      harness.deps,
      input([
        web,
        { ...glitch, taskLabels: [' source:glitchtip ', 'repo:ops'] },
      ]),
    );
    expect(harness.labelled).toEqual([
      { externalId: 'example/web#1' },
      {
        externalId: 'https://glitchtip.example.com/example/web#2',
        labels: ['source:glitchtip', 'repo:ops'],
      },
    ]);
  });

  it('refuses a task label that is no label name [TASK-R62]', () => {
    for (const taskLabels of [
      [''],
      ['x'.repeat(51)],
      Array.from({ length: 11 }, (_, at) => `label-${at}`),
    ]) {
      expect(
        issueSyncInputSchema.safeParse({
          projectId: 'project-1',
          sources: [{ ...web, taskLabels }],
        }).success,
      ).toBe(false);
    }
  });
});

describe('task.sync_issues isolation', () => {
  it('syncs the other sources when one source fails [TASK-R53]', async () => {
    const harness = fakes({
      list: {
        github: (listInput) => {
          if (listInput.repo === 'gone') {
            throw new IssueSourceHttpError(
              'GitHub issue sync failed (HTTP 404).',
              {
                status: 404,
                retryAfter: null,
                action: 'github.list_import_issues',
              },
            );
          }
          return {
            issues: [issue('1')],
            truncated: false,
            nextCursor: null,
            repositoryId: 10,
          };
        },
        glitchtip: () => {
          throw new ConnectorError(
            'CREDENTIAL_UNRESOLVED',
            'no usable credential for glitchtip: none connected',
          );
        },
      },
    });
    const result = await syncIssueSources(
      harness.deps,
      input([{ ...web, repo: 'gone' }, web, glitch]),
    );
    expect(
      result.sources.map((receipt) => [receipt.ok, receipt.error]),
    ).toEqual([
      [false, 'not_found'],
      [true, null],
      [false, 'credential'],
    ]);
    expect(result).toMatchObject({ failed: 2, created: 1 });
    expect(result.sources[0]?.message).toContain('HTTP 404');
    expect(result.sources[0]?.status).toBe(404);
    // The failed sources saved nothing and keep their batch for next run.
    expect(
      harness.row({ externalSystem: 'github', source: 'example/gone' }),
    ).toMatchObject({ cursor: null, attempts: 1 });
  });

  it('skips an issue the tracker refuses, and writes the rest of its source [TASK-R55]', async () => {
    const linked = ['1', '2', '3'].map((id) => ({
      taskId: `task-${id}`,
      externalId: `example/web#${id}`,
      externalIssue: snapshot(id, { syncedAt: NOW - 1000 }),
    }));
    const tasks = new Map(
      linked.map((row) => [row.externalIssue.id, row.externalIssue]),
    );
    const harness = fakes({
      tasks,
      linked,
      list: { github: listing([issue('4'), issue('5')], null) },
      refresh: {
        github: () => ({
          issues: [issue('1'), issue('3', { title: 'Renamed upstream' })],
          failed: [
            { externalId: 'example/web#2', error: 'unauthorized', status: 403 },
          ],
          notRead: 0,
          retryAfter: null,
        }),
      },
      refuse: new Set(['example/web#5']),
    });
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(result.sources[0]).toMatchObject({
      ok: true,
      saved: true,
      discovered: 2,
      created: 1,
      refreshed: 1,
      unchanged: 1,
      skipped: 2,
      skippedIssues: [
        { externalId: 'example/web#2', reason: 'unauthorized' },
        { externalId: 'example/web#5', reason: 'TASK_EXTERNAL_REF_INVALID' },
      ],
    });
    expect(harness.writes).toEqual([
      'example/web#1',
      'example/web#3',
      'example/web#4',
      'example/web#5',
    ]);
    expect(harness.calls[1]).toMatchObject({
      action: 'refresh_import_issues',
      input: { repositoryId: 10, report: true },
    });
  });

  it('writes an issue read by both the listing and the refresh once, with the newer read [TASK-R55]', async () => {
    const linked = [
      {
        taskId: 'task-1',
        externalId: 'example/web#1',
        externalIssue: snapshot('1', { syncedAt: NOW - 1000 }),
      },
    ];
    const harness = fakes({
      tasks: new Map([['1', linked[0]!.externalIssue]]),
      linked,
      list: { github: listing([issue('1', { title: 'Listed' })], null) },
      refresh: {
        github: () => ({
          issues: [issue('1', { title: 'Refreshed' })],
          failed: [],
          notRead: 0,
          retryAfter: null,
        }),
      },
    });
    await syncIssueSources(harness.deps, input([web]));
    expect(harness.writes).toEqual(['example/web#1']);
    expect(harness.tasks.get('1')?.title).toBe('Refreshed');
  });

  it('writes the new batch even when the whole refresh fails [TASK-R55]', async () => {
    const harness = fakes({
      linked: [
        {
          taskId: 'task-1',
          externalId: 'example/web#1',
          externalIssue: snapshot('1'),
        },
      ],
      list: { github: listing([issue('2')], null) },
      refresh: {
        github: () => {
          throw new ConnectorError('REQUEST_FAILED', 'fetch failed');
        },
      },
    });
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(result.sources[0]).toMatchObject({
      ok: true,
      created: 1,
      skipped: 1,
      skippedIssues: [{ externalId: 'example/web#1', reason: 'unavailable' }],
      saved: true,
    });
  });

  it('keeps a tracker’s own words out of the receipt [TASK-R53]', async () => {
    const harness = fakes({
      list: {
        github: () => {
          throw new ConnectorError(
            'LIVE_BODY_FAILED',
            'the live github.list_import_issues call failed: response body is not JSON (status 200, content-type text/html): <html>internal build 4711</html>',
          );
        },
      },
    });
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(result.sources[0]).toMatchObject({ ok: false, error: 'failed' });
    expect(result.sources[0]?.message).not.toContain('4711');
    expect(result.sources[0]?.message).not.toContain('<html>');
  });

  it('refreshes nothing with refreshLimit 0', async () => {
    const harness = fakes({
      linked: [
        {
          taskId: 'task-1',
          externalId: 'example/web#1',
          externalIssue: snapshot('1'),
        },
      ],
      list: { github: listing([], null) },
    });
    await syncIssueSources(harness.deps, input([web], { refreshLimit: 0 }));
    expect(harness.calls.map((call) => call.action)).toEqual([
      'list_import_issues',
    ]);
  });

  it('stops between issues once its server is stopping, saving nothing', async () => {
    const stop = new AbortController();
    const harness = fakes({
      signal: stop.signal,
      list: {
        github: () => {
          stop.abort();
          return {
            issues: [issue('1')],
            truncated: false,
            nextCursor: null,
            repositoryId: 10,
          };
        },
      },
    });
    await expect(
      syncIssueSources(harness.deps, input([web])),
    ).rejects.toMatchObject({ code: 'INTERRUPTED' });
    expect(harness.writes).toEqual([]);
    expect(harness.failures).toEqual([]);
  });
});

describe('task.sync_issues rate limits', () => {
  const limited = (retryAfter: number) =>
    new IssueSourceHttpError('GitHub rate-limited the issue sync (HTTP 403).', {
      status: 403,
      retryAfter,
      action: 'github.list_import_issues',
    });

  it('stops a rate-limited source without counting a failure, and leaves it alone until the wait is over [TASK-R56]', async () => {
    const wait = NOW + 30 * 60 * 1000;
    let limit = true;
    const harness = fakes({
      list: {
        github: () => {
          if (limit) throw limited(wait);
          return {
            issues: [issue('1')],
            truncated: false,
            nextCursor: null,
            repositoryId: 10,
          };
        },
        glitchtip: glitchListing,
      },
    });
    const first = await syncIssueSources(harness.deps, input([web, glitch]));
    expect(first.sources[0]).toMatchObject({
      ok: false,
      error: 'rate_limited',
      retryAfter: wait,
      saved: false,
    });
    expect(first).toMatchObject({ failed: 0, rateLimited: 1 });
    expect(harness.failures).toEqual([]);
    limit = false;
    const listed = harness.calls.length;
    const second = await syncIssueSources(harness.deps, input([web, glitch]));
    expect(second.sources[0]).toMatchObject({
      ok: false,
      error: 'rate_limited',
      retryAfter: wait,
    });
    // Only the GlitchTip source was read: GitHub was left alone.
    expect(harness.calls.slice(listed).map((call) => call.connector)).toEqual([
      'glitchtip',
    ]);
    harness.row({
      externalSystem: 'github',
      source: 'example/web',
    }).retryAfter = NOW - 1;
    const third = await syncIssueSources(harness.deps, input([web, glitch]));
    expect(third.sources[0]).toMatchObject({ ok: true, created: 1 });
  });

  it('keeps what a source did before its refresh was rate-limited, with the wait [TASK-R56]', async () => {
    const wait = NOW + 10 * 60 * 1000;
    const linked = ['1', '2'].map((id) => ({
      taskId: `task-${id}`,
      externalId: `example/web#${id}`,
      externalIssue: snapshot(id),
    }));
    const harness = fakes({
      tasks: new Map(
        linked.map((row) => [row.externalIssue.id, row.externalIssue]),
      ),
      linked,
      list: { github: listing([issue('3')], 'page-2') },
      refresh: {
        github: () => ({
          issues: [issue('1', { state: 'closed' })],
          failed: [
            { externalId: 'example/web#2', error: 'rate_limited', status: 429 },
          ],
          notRead: 0,
          retryAfter: wait,
        }),
      },
    });
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(result.sources[0]).toMatchObject({
      ok: true,
      saved: true,
      created: 1,
      closedUpstream: 1,
      skipped: 1,
      retryAfter: wait,
    });
    expect(
      harness.row({ externalSystem: 'github', source: 'example/web' }),
    ).toMatchObject({ cursor: 'page-2', retryAfter: wait });
  });
});

describe('task.sync_issues upstream lifecycle', () => {
  it('counts issues closed, reopened and gone upstream, writing only their snapshots [TASK-R60]', async () => {
    const before = {
      '1': snapshot('1'),
      '2': snapshot('2', { state: 'closed' }),
      '3': snapshot('3'),
      '4': snapshot('4'),
    };
    const harness = fakes({
      tasks: new Map(Object.entries(before)),
      linked: Object.entries(before).map(([id, externalIssue]) => ({
        taskId: `task-${id}`,
        externalId: `example/web#${id}`,
        externalIssue,
      })),
      list: { github: listing([], null) },
      refresh: {
        github: () => ({
          issues: [
            issue('1', { state: 'closed' }),
            issue('2', { state: 'open' }),
            issue('3', { unavailable: true }),
            issue('4'),
          ],
          failed: [],
          notRead: 0,
          retryAfter: null,
        }),
      },
    });
    const result = await syncIssueSources(harness.deps, input([web]));
    expect(result.sources[0]).toMatchObject({
      refreshed: 3,
      unchanged: 1,
      closedUpstream: 1,
      reopenedUpstream: 1,
      unavailableUpstream: 1,
      created: 0,
    });
    expect(result.closedUpstream).toBe(1);
  });
});

describe('when the step fails', () => {
  const result = (failed: number, sources: number) => ({
    sources: Array.from({ length: sources }, () => ({}) as IssueSourceReceipt),
    failed,
    rateLimited: 0,
    created: 0,
    refreshed: 0,
    unchanged: 0,
    skipped: 0,
    closedUpstream: 0,
  });

  it('fails by default only when every source failed [TASK-R54]', () => {
    expect(issueSyncFails(result(1, 2))).toBe(false);
    expect(issueSyncFails(result(2, 2))).toBe(true);
    expect(issueSyncFails(result(1, 2), 'all')).toBe(false);
  });

  it('fails as soon as one source failed when the step asks to [TASK-R61]', () => {
    expect(issueSyncFails(result(0, 2), 'any')).toBe(false);
    expect(issueSyncFails(result(1, 2), 'any')).toBe(true);
    expect(issueSyncFails(result(2, 2), 'any')).toBe(true);
  });

  it('counts a source waiting out a rate limit as no failure, either way [TASK-R61]', async () => {
    const harness = fakes({
      list: {
        github: listing([], null),
        glitchtip: () => {
          throw new IssueSourceHttpError('GlitchTip rate-limited the sync.', {
            status: 429,
            retryAfter: NOW + 60_000,
            action: 'glitchtip.list_import_issues',
          });
        },
      },
    });
    const synced = await syncIssueSources(harness.deps, input([web, glitch]));
    expect(synced.failed).toBe(0);
    expect(failedSources(synced.sources)).toEqual([]);
    expect(issueSyncFails(synced, 'any')).toBe(false);
  });
});

describe('the step failure when every source failed', () => {
  const receipt = (
    error: IssueSourceReceipt['error'],
    kind = 'github',
  ): IssueSourceReceipt => ({
    kind,
    source: 'example/web',
    ok: false,
    error,
    batch: 1,
    resumed: false,
    restarted: false,
    saved: false,
    conflict: false,
    drained: false,
    discovered: 0,
    created: 0,
    refreshed: 0,
    unchanged: 0,
    skipped: 0,
    closedUpstream: 0,
    reopenedUpstream: 0,
    unavailableUpstream: 0,
    retryAfter: null,
  });

  it.each([
    ['credential', 'CONNECTOR_CREDENTIAL_MISSING'],
    ['unauthorized', 'CONNECTOR_AUTH'],
    ['not_found', 'CONNECTOR_NOT_FOUND'],
    ['unavailable', 'CONNECTOR_UNREACHABLE'],
    ['invalid_response', 'CONNECTOR_FAILED'],
  ] as const)(
    'names the cause every source shares (%s) [TASK-R54]',
    (error, reason) => {
      expect(issueSyncFailure([receipt(error), receipt(error)]).reason).toBe(
        reason,
      );
    },
  );

  it('names the tracker, its listing and the status it answered for one kind of source [TASK-R54]', () => {
    expect(
      issueSyncFailure([
        { ...receipt('unauthorized'), status: 401 },
        { ...receipt('unauthorized'), status: 401 },
      ]),
    ).toEqual({
      reason: 'CONNECTOR_AUTH',
      params: {
        connector: 'github',
        action: 'github.list_import_issues',
        status: 401,
      },
    });
  });

  it('names a connector failure listing each source when their causes differ [TASK-R54]', () => {
    expect(
      issueSyncFailure([
        receipt('unauthorized'),
        receipt('unavailable', 'glitchtip'),
      ]),
    ).toMatchObject({
      reason: 'CONNECTOR_FAILED',
      params: {
        connector: 'task',
        detail:
          'github example/web: unauthorized; glitchtip example/web: unavailable',
      },
    });
  });
});
