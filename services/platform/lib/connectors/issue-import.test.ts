import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TASK_DESCRIPTION_MAX } from '../../backend/core/tasks/helpers';
import { ConnectorError } from './errors';
import {
  IssueSourceHttpError,
  issueImportNatives,
  rateLimitWait,
} from './natives/issue-import';

const fetchPage = vi.fn();
const endpoint = 'https://glitchtip.tale.dev';
function response(
  rows: unknown,
  link = '',
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers: { link, ...headers },
    json: () => rows,
    text: () => JSON.stringify(rows),
  };
}
function githubIssue(number: number) {
  return {
    id: number + 1000,
    number,
    title: `Issue ${number}`,
    body: 'Details',
    state: 'open',
    html_url: `https://github.com/Example/Web/issues/${number}`,
  };
}
function glitchtipIssue(id: number) {
  return {
    id: String(id),
    title: `Error ${id}`,
    project: { id: '20', slug: 'web' },
    status: 'unresolved',
    culprit: 'app.ts',
    metadata: { value: 'Failed' },
  };
}
function run(provider: string, overrides: Record<string, unknown> = {}) {
  const native = issueImportNatives()[`${provider}.list_import_issues`];
  const input =
    provider === 'github'
      ? { owner: 'Example', repo: 'Web' }
      : { organization: 'example', project: 'web' };
  const http = {
    get: async (url: string, options: unknown) => {
      if (url === 'https://api.github.com/repos/Example/Web')
        return response({ id: 10 });
      if (url === `${endpoint}/api/0/projects/example/web/`)
        return response({ id: '20' });
      return fetchPage(url, options);
    },
  };
  return native?.({ ...input, ...overrides }, { endpoint, http } as never);
}

beforeEach(() => vi.resetAllMocks());

describe('GitHub live issue intake', () => {
  it('follows pages, ignores pull requests, deduplicates repeats, and canonicalizes the ref', async () => {
    fetchPage.mockResolvedValueOnce(
      response(
        [{ ...githubIssue(1), pull_request: {} }, githubIssue(2)],
        '<https://api.github.com/next>; rel="next"',
      ),
    );
    fetchPage.mockResolvedValueOnce(response([githubIssue(2), githubIssue(3)]));
    await expect(
      run('github', { labels: 'bug,needs triage' }),
    ).resolves.toMatchObject({
      issues: [2, 3].map((n) => ({
        externalSystem: 'github',
        externalId: `example/web#${n}`,
        title: `Issue ${n}`,
        description: 'Details',
        externalUrl: `https://github.com/Example/Web/issues/${n}`,
      })),
      truncated: false,
    });
    expect(fetchPage.mock.calls[0]?.[0]).toContain(
      'labels=bug%2Cneeds%20triage',
    );
    expect(fetchPage.mock.calls[1]?.[0]).toContain('page=2');
  });

  it('looks past a full page of pull requests and reports a real issue limit', async () => {
    fetchPage.mockResolvedValueOnce(
      response(
        Array.from({ length: 100 }, (_, n) => ({
          ...githubIssue(n + 1),
          pull_request: {},
        })),
        '<https://api.github.com/next>; rel="next"',
      ),
    );
    fetchPage.mockResolvedValueOnce(
      response([githubIssue(101), githubIssue(102)]),
    );
    await expect(run('github', { limit: 1 })).resolves.toMatchObject({
      issues: [{ externalId: 'example/web#101' }],
      truncated: true,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('does not mark an exact terminal page as truncated', async () => {
    fetchPage.mockResolvedValue(response([githubIssue(1)]));
    await expect(run('github', { limit: 1 })).resolves.toMatchObject({
      truncated: false,
    });
  });

  it('bounds even a stream of only pull requests and reports the unfinished scan', async () => {
    fetchPage.mockResolvedValue(
      response(
        [{ ...githubIssue(1), pull_request: {} }],
        '<https://api.github.com/next>; rel="next"',
      ),
    );
    await expect(run('github')).resolves.toMatchObject({
      issues: [],
      truncated: true,
    });
    expect(fetchPage).toHaveBeenCalledTimes(20);
  });

  it.each([
    null,
    { message: 'error' },
    [{ number: 0, title: 'Broken' }],
    [{ number: 1, title: '' }],
  ])('fails closed on malformed upstream data %j', async (rows) => {
    fetchPage.mockResolvedValue(response(rows));
    await expect(run('github')).rejects.toThrow();
  });
});

describe('GlitchTip 6 issue intake', () => {
  it('uses the Sentry cursor attributes without following upstream URLs and retains origin in refs', async () => {
    fetchPage.mockResolvedValueOnce(
      response(
        [glitchtipIssue(1)],
        '<https://untrusted.example/steal>; rel="next"; results="true"; cursor="abc:2:0"',
      ),
    );
    fetchPage.mockResolvedValueOnce(
      response(
        [glitchtipIssue(2)],
        '<https://untrusted.example/>; rel="next"; results="false"',
      ),
    );
    await expect(run('glitchtip')).resolves.toMatchObject({
      issues: [1, 2].map((id) => ({
        externalSystem: 'glitchtip',
        externalId: `${endpoint}/example/web#${id}`,
        title: `Error ${id}`,
        description: 'app.ts\n\nFailed',
        externalUrl: `${endpoint}/example/issues/${id}`,
      })),
      truncated: false,
    });
    expect(fetchPage.mock.calls[0]?.[0]).toContain(
      '/api/0/projects/example/web/issues/?limit=100&sort=first_seen&query=is%3Aunresolved',
    );
    expect(fetchPage.mock.calls[1]?.[0]).toBe(
      `${endpoint}/api/0/projects/example/web/issues/?limit=100&sort=first_seen&query=is%3Aunresolved&cursor=abc%3A2%3A0`,
    );
  });

  it('does not silently shorten a list when a cursor repeats', async () => {
    fetchPage.mockResolvedValue(
      response(
        [glitchtipIssue(1)],
        '<https://upstream/>; rel="next"; results="true"; cursor="repeat"',
      ),
    );
    await expect(run('glitchtip')).rejects.toThrow(
      /repeated pagination cursor/,
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    {},
    [{ ...glitchtipIssue(1), project: { id: '999', slug: 'foreign' } }],
    [{ ...glitchtipIssue(1), id: 'NaN' }],
  ])('rejects malformed or foreign project data %j', async (rows) => {
    fetchPage.mockResolvedValue(response(rows));
    await expect(run('glitchtip')).rejects.toThrow();
  });

  it('honors query and limit, reports truncation, and keeps empty metadata safe', async () => {
    fetchPage.mockResolvedValue(
      response([
        { ...glitchtipIssue(1), culprit: null, metadata: null },
        glitchtipIssue(2),
      ]),
    );
    await expect(
      run('glitchtip', { limit: 1, query: 'is:unresolved environment:prod' }),
    ).resolves.toMatchObject({
      issues: [{ description: '' }],
      truncated: true,
    });
    expect(fetchPage.mock.calls[0]?.[0]).toContain(
      'query=is%3Aunresolved%20environment%3Aprod',
    );
  });
});

describe.each(['github', 'glitchtip'])('%s upstream failures', (provider) => {
  it.each([401, 403, 429, 500])(
    'propagates HTTP %s instead of importing a partial result',
    async (status) => {
      fetchPage.mockResolvedValue(
        response({ sensitive: 'never echo vendor bodies' }, '', status),
      );
      await expect(run(provider)).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it('propagates a failed later page before any task intake can run', async () => {
    fetchPage.mockResolvedValueOnce(
      response(
        [provider === 'github' ? githubIssue(1) : glitchtipIssue(1)],
        '<https://upstream/>; rel="next"; results="true"; cursor="next"',
      ),
    );
    fetchPage.mockRejectedValueOnce(new Error('network interrupted'));
    await expect(run(provider)).rejects.toThrow('network interrupted');
  });

  it('accepts an empty issue list as a complete result', async () => {
    fetchPage.mockResolvedValue(response([]));
    await expect(run(provider)).resolves.toMatchObject({
      issues: [],
      truncated: false,
    });
  });
});

describe('resumable discovery', () => {
  it.each(['github', 'glitchtip'])(
    '%s continues inside a page without skipping issues',
    async (provider) => {
      const item = provider === 'github' ? githubIssue : glitchtipIssue;
      fetchPage.mockResolvedValue(response([item(1), item(2), item(3)]));
      const first = (await run(provider, { limit: 1 })) as {
        nextCursor: string;
      };
      const second = (await run(provider, {
        limit: 1,
        cursor: first.nextCursor,
      })) as { nextCursor: string };
      const third = await run(provider, {
        limit: 1,
        cursor: second.nextCursor,
      });
      expect(second).toMatchObject({
        issues: [
          {
            externalIssue: {
              id: provider === 'github' ? '1002' : `${endpoint}#2`,
            },
          },
        ],
        truncated: true,
      });
      expect(third).toMatchObject({
        issues: [
          {
            externalIssue: {
              id: provider === 'github' ? '1003' : `${endpoint}#3`,
            },
          },
        ],
        truncated: false,
        nextCursor: null,
      });
    },
  );

  it.each(['github', 'glitchtip'])(
    '%s restarts safely when the boundary issue disappears from the filter',
    async (provider) => {
      const item = provider === 'github' ? githubIssue : glitchtipIssue;
      fetchPage.mockResolvedValueOnce(response([item(1), item(2), item(3)]));
      const first = (await run(provider, { limit: 1 })) as {
        nextCursor: string;
      };
      fetchPage.mockResolvedValue(response([item(2), item(3)]));
      const second = await run(provider, {
        limit: 1,
        cursor: first.nextCursor,
      });
      expect(second).toMatchObject({
        issues: [
          {
            externalIssue: {
              id: provider === 'github' ? '1002' : `${endpoint}#2`,
            },
          },
        ],
      });
    },
  );

  it('retains an anchor on a full page boundary before following the next page', async () => {
    fetchPage.mockResolvedValueOnce(
      response([githubIssue(1)], '<https://api.github.com/next>; rel="next"'),
    );
    const first = (await run('github', { limit: 1 })) as { nextCursor: string };
    expect(JSON.parse(first.nextCursor)).toMatchObject({
      page: 1,
      offset: 1,
      anchor: '1001',
    });
    fetchPage.mockResolvedValueOnce(
      response([githubIssue(1)], '<https://api.github.com/next>; rel="next"'),
    );
    fetchPage.mockResolvedValueOnce(response([githubIssue(2)]));
    await expect(
      run('github', { limit: 1, cursor: first.nextCursor }),
    ).resolves.toMatchObject({
      issues: [{ externalIssue: { id: '1002' } }],
      nextCursor: null,
    });
  });

  it('rejects continuation after changing the source filter', async () => {
    fetchPage.mockResolvedValue(response([githubIssue(1), githubIssue(2)]));
    const first = (await run('github', { limit: 1 })) as { nextCursor: string };
    await expect(
      run('github', { cursor: first.nextCursor, labels: 'different' }),
    ).rejects.toThrow(/another source or filter/);
  });
});

function source(provider: string) {
  const isGithub = provider === 'github';
  return {
    externalId: isGithub ? 'example/web#1' : `${endpoint}/example/web#1`,
    externalIssue: {
      id: isGithub ? '1001' : `${endpoint}#1`,
      title: 'Original',
      description: 'Original body',
      url: isGithub
        ? 'https://github.com/Example/Web/issues/1'
        : `${endpoint}/example/issues/1`,
      state: 'open',
      syncedAt: 1,
      ...(isGithub
        ? { repositoryId: 10, number: 1 }
        : { sourceProjectId: '20' }),
    },
  };
}
function refresh(provider: string, issue = source(provider)) {
  return issueImportNatives()[`${provider}.get_import_issue`]?.(
    { issue, ...(provider === 'glitchtip' ? { organization: 'example' } : {}) },
    { endpoint, http: { get: fetchPage } } as never,
  );
}

describe.each(['github', 'glitchtip'])(
  '%s editable local description',
  (provider) => {
    function sourceRow(body: string) {
      return provider === 'github'
        ? { ...githubIssue(1), body }
        : { ...glitchtipIssue(1), culprit: null, metadata: { value: body } };
    }

    // The native seeds the description the task domain's own cut makes
    // (`truncateImportedDescription`): the board's cap, which every door
    // can save again. It used to pre-cut at a local 50,000 — past that cap,
    // so the board refused an unchanged imported description (TALE-75).
    it.each([TASK_DESCRIPTION_MAX + 1, 65_000, 100_001])(
      'keeps a %i-character source body while seeding a description the task editor accepts',
      async (length) => {
        const row = sourceRow('d'.repeat(length));
        fetchPage.mockResolvedValueOnce(response([row]));
        const imported = (await run(provider)) as {
          issues: {
            description: string;
            externalIssue: { description: string };
          }[];
        };
        const seeded = `${'d'.repeat(TASK_DESCRIPTION_MAX - 1)}…`;
        expect(imported.issues[0]?.description).toBe(seeded);
        expect(imported.issues[0]?.externalIssue.description.length).toBe(
          Math.min(length, 100_000),
        );
        fetchPage.mockResolvedValueOnce(response(row));
        const refreshed = (await refresh(provider)) as {
          description: string;
          externalIssue: { description: string };
        };
        expect(refreshed.description).toBe(seeded);
        expect(refreshed.externalIssue.description.length).toBe(
          Math.min(length, 100_000),
        );
      },
    );

    it('seeds a body that fits whole', async () => {
      fetchPage.mockResolvedValueOnce(
        response([sourceRow('d'.repeat(TASK_DESCRIPTION_MAX))]),
      );
      const imported = (await run(provider)) as {
        issues: { description: string }[];
      };
      expect(imported.issues[0]?.description).toBe(
        'd'.repeat(TASK_DESCRIPTION_MAX),
      );
    });

    // A code-unit slice left the emoji's high surrogate alone at the end.
    it('cuts on a grapheme boundary, never inside an emoji', async () => {
      const body = `${'d'.repeat(TASK_DESCRIPTION_MAX - 2)}👍🏽 and more`;
      fetchPage.mockResolvedValueOnce(response([sourceRow(body)]));
      const imported = (await run(provider)) as {
        issues: { description: string }[];
      };
      expect(imported.issues[0]?.description).toBe(
        `${'d'.repeat(TASK_DESCRIPTION_MAX - 2)}…`,
      );
    });

    it('retains a long unavailable snapshot without seeding an uneditable description', async () => {
      const issue = source(provider);
      issue.externalIssue.description = 'd'.repeat(100_000);
      fetchPage.mockResolvedValue(response({}, '', 404));
      const refreshed = (await refresh(provider, issue)) as {
        description: string;
        externalIssue: { description: string; unavailable: boolean };
      };
      expect(refreshed.description).toBe(
        `${'d'.repeat(TASK_DESCRIPTION_MAX - 1)}…`,
      );
      expect(refreshed.externalIssue.description.length).toBe(100_000);
      expect(refreshed.externalIssue.unavailable).toBe(true);
    });
  },
);

describe.each(['github', 'glitchtip'])(
  '%s immutable source refresh',
  (provider) => {
    it('refreshes closed/resolved source details independently of the open discovery query', async () => {
      fetchPage.mockResolvedValue(
        response(
          provider === 'github'
            ? { ...githubIssue(1), state: 'closed', title: 'Changed upstream' }
            : {
                ...glitchtipIssue(1),
                status: 'resolved',
                title: 'Changed upstream',
              },
        ),
      );
      await expect(refresh(provider)).resolves.toMatchObject({
        title: 'Changed upstream',
        externalIssue: {
          state: provider === 'github' ? 'closed' : 'resolved',
          title: 'Changed upstream',
          syncedAt: expect.any(Number),
        },
      });
      expect(fetchPage.mock.calls[0]?.[0]).toBe(
        provider === 'github'
          ? 'https://api.github.com/repositories/10/issues/1'
          : `${endpoint}/api/0/issues/1/`,
      );
    });
    it.each([404, 410])(
      'marks HTTP %s unavailable while retaining last known state and content',
      async (status) => {
        fetchPage.mockResolvedValue(response({}, '', status));
        await expect(refresh(provider)).resolves.toMatchObject({
          externalIssue: {
            title: 'Original',
            description: 'Original body',
            state: 'open',
            unavailable: true,
          },
        });
      },
    );
    it.each([401, 403, 429, 500])(
      'propagates HTTP %s without claiming the source disappeared',
      async (status) => {
        fetchPage.mockResolvedValue(response({}, '', status));
        await expect(refresh(provider)).rejects.toThrow(`HTTP ${status}`);
      },
    );
    it('refuses a mismatching immutable identity', async () => {
      fetchPage.mockResolvedValue(
        response(provider === 'github' ? githubIssue(2) : glitchtipIssue(2)),
      );
      await expect(refresh(provider)).rejects.toThrow(
        /different issue identity/,
      );
    });
  },
);

it('refreshes the repository locator after a GitHub issue transfer or repository rename', async () => {
  fetchPage.mockResolvedValueOnce(
    response({
      ...githubIssue(2),
      id: 1001,
      html_url: 'https://github.com/NewOwner/NewRepo/issues/2',
    }),
  );
  fetchPage.mockResolvedValueOnce(response({ id: 99 }));
  await expect(refresh('github')).resolves.toMatchObject({
    externalId: 'newowner/newrepo#2',
    externalIssue: {
      id: '1001',
      repositoryId: 99,
      number: 2,
      url: 'https://github.com/NewOwner/NewRepo/issues/2',
    },
  });
  expect(fetchPage.mock.calls[1]?.[0]).toBe(
    'https://api.github.com/repos/NewOwner/NewRepo',
  );
});

it('refuses a GlitchTip list row with a different project id despite a matching slug', async () => {
  fetchPage.mockResolvedValue(
    response([{ ...glitchtipIssue(1), project: { id: '999', slug: 'web' } }]),
  );
  await expect(run('glitchtip')).rejects.toThrow(/different project/);
});

it.each(['example/web#1', 'Example/WEB#1'])(
  'hydrates legacy GitHub reference %s even after it has closed upstream',
  async (externalId) => {
    fetchPage.mockResolvedValue(
      response({ ...githubIssue(1), state: 'closed' }),
    );
    await expect(
      issueImportNatives()['github.refresh_import_issues']?.(
        {
          repositoryId: 10,
          issues: [{ externalId, externalIssue: null }],
        },
        { http: { get: fetchPage } } as never,
      ),
    ).resolves.toMatchObject([
      {
        externalId,
        externalIssue: {
          id: '1001',
          state: 'closed',
          repositoryId: 10,
          number: 1,
        },
      },
    ]);
    expect(fetchPage.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repositories/10/issues/1',
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  },
);

it('hydrates a legacy GlitchTip reference including its resolved state', async () => {
  fetchPage.mockResolvedValue(
    response({ ...glitchtipIssue(1), status: 'resolved' }),
  );
  await expect(
    issueImportNatives()['glitchtip.refresh_import_issues']?.(
      {
        organization: 'example',
        sourceProjectId: '20',
        issues: [
          { externalId: `${endpoint}/example/web#1`, externalIssue: null },
        ],
      },
      { endpoint, http: { get: fetchPage } } as never,
    ),
  ).resolves.toMatchObject([
    {
      externalIssue: {
        id: `${endpoint}#1`,
        state: 'resolved',
        sourceProjectId: '20',
      },
    },
  ]);
});

it('adopts a renamed legacy repository through its stored locator and links the canonical issue', async () => {
  fetchPage.mockResolvedValueOnce(
    response({
      ...githubIssue(1),
      state: 'closed',
      html_url: 'https://github.com/Example/NewName/issues/1',
    }),
  );
  fetchPage.mockResolvedValueOnce(response({ id: 10 }));
  await expect(
    issueImportNatives()['github.refresh_import_issues']?.(
      {
        repositoryId: 10,
        issues: [{ externalId: 'example/web#1', externalIssue: null }],
      },
      { http: { get: fetchPage } } as never,
    ),
  ).resolves.toMatchObject([
    {
      externalId: 'example/web#1',
      externalUrl: 'https://github.com/Example/NewName/issues/1',
      externalIssue: {
        id: '1001',
        repositoryId: 10,
        state: 'closed',
        url: 'https://github.com/Example/NewName/issues/1',
      },
    },
  ]);
});

it('does not invent an immutable identity for a missing legacy source', async () => {
  fetchPage.mockResolvedValue(response({}, '', 404));
  await expect(
    issueImportNatives()['github.refresh_import_issues']?.(
      {
        repositoryId: 10,
        issues: [{ externalId: 'example/web#1', externalIssue: null }],
      },
      { http: { get: fetchPage } } as never,
    ),
  ).resolves.toEqual([]);
});

describe('rate limits', () => {
  const NOW = Date.parse('2026-10-14T18:00:00Z');
  const answer = (
    status: number,
    headers: Record<string, string> = {},
    body: unknown = {},
  ) => response(body, '', status, headers);

  it.each([
    [
      'a 429 with Retry-After seconds',
      answer(429, { 'retry-after': '120' }),
      NOW + 120_000,
    ],
    [
      'a 429 with Retry-After as a date',
      answer(429, { 'retry-after': new Date(NOW + 90_000).toUTCString() }),
      NOW + 90_000,
    ],
    [
      "GitHub's secondary limit, a 403 with Retry-After",
      answer(403, { 'retry-after': '30' }),
      NOW + 30_000,
    ],
    [
      "GitHub's primary limit, a 403 with the reset time",
      answer(403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String((NOW + 600_000) / 1000),
      }),
      NOW + 600_000,
    ],
    [
      "GitHub's secondary limit named only in its message, for a minute",
      answer(403, {}, { message: 'You have exceeded a secondary rate limit.' }),
      NOW + 60_000,
    ],
    [
      'a wait longer than a day, cut to one',
      answer(429, { 'retry-after': '999999' }),
      NOW + 86_400_000,
    ],
  ])('reads %s as a wait [TASK-R56]', (_case, limited, until) => {
    expect(rateLimitWait(limited as never, NOW)).toBe(until);
  });

  it.each([
    [
      'a 403 that refuses access',
      answer(403, { 'x-ratelimit-remaining': '41' }),
    ],
    ['a 404', answer(404)],
    ['a 500', answer(500)],
  ])('reads %s as no wait [TASK-R56]', (_case, refused) => {
    expect(rateLimitWait(refused as never, NOW)).toBeNull();
  });

  it.each(['github', 'glitchtip'])(
    'fails a %s listing the tracker rate-limits with its status and wait, as a rate limit [TASK-R56]',
    async (provider) => {
      const before = Date.now();
      fetchPage.mockResolvedValue(answer(429, { 'retry-after': '60' }));
      const failure = await run(provider).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(IssueSourceHttpError);
      expect(failure).toMatchObject({
        status: 429,
        failure: {
          reason: 'CONNECTOR_RATE_LIMITED',
          params: { connector: provider, status: 429 },
        },
      });
      expect(
        (failure as IssueSourceHttpError).retryAfter,
      ).toBeGreaterThanOrEqual(before + 60_000);
    },
  );

  it('fails a refused listing with its status and no wait, so a run record names the cause', async () => {
    fetchPage.mockResolvedValue(answer(401));
    await expect(run('github')).rejects.toMatchObject({
      status: 401,
      retryAfter: null,
    });
  });
});

function linked(provider: string, n: number) {
  const isGithub = provider === 'github';
  return {
    externalId: isGithub ? `example/web#${n}` : `${endpoint}/example/web#${n}`,
    externalIssue: {
      id: isGithub ? String(1000 + n) : `${endpoint}#${n}`,
      title: `Issue ${n}`,
      description: 'Details',
      url: isGithub
        ? `https://github.com/Example/Web/issues/${n}`
        : `${endpoint}/example/issues/${n}`,
      state: 'open',
      syncedAt: 1,
      ...(isGithub
        ? { repositoryId: 10, number: n }
        : { sourceProjectId: '20' }),
    },
  };
}

function refreshAll(provider: string, count: number, report?: boolean) {
  return issueImportNatives()[`${provider}.refresh_import_issues`]?.(
    {
      issues: Array.from({ length: count }, (_, at) =>
        linked(provider, at + 1),
      ),
      ...(provider === 'github'
        ? { repositoryId: 10 }
        : { organization: 'example', sourceProjectId: '20' }),
      ...(report !== undefined && { report }),
    },
    { endpoint, http: { get: fetchPage } } as never,
  );
}

/** The issue number a refresh request asks for. */
function asked(url: string): number {
  return Number(/\/issues\/(\d+)\/?$/.exec(url)?.[1]);
}

describe.each(['github', 'glitchtip'])(
  '%s refresh of linked issues',
  (provider) => {
    const item = (n: number) =>
      provider === 'github' ? githubIssue(n) : glitchtipIssue(n);

    it('skips an issue the tracker refuses and refreshes the others [TASK-R55]', async () => {
      fetchPage.mockImplementation(async (url: string) =>
        asked(url) === 2 ? response({}, '', 403) : response(item(asked(url))),
      );
      await expect(refreshAll(provider, 3, true)).resolves.toMatchObject({
        issues: [
          {
            externalIssue: {
              title: provider === 'github' ? 'Issue 1' : 'Error 1',
            },
          },
          {
            externalIssue: {
              title: provider === 'github' ? 'Issue 3' : 'Error 3',
            },
          },
        ],
        failed: [
          {
            externalId: linked(provider, 2).externalId,
            error: 'unauthorized',
            status: 403,
          },
        ],
        notRead: 0,
        retryAfter: null,
      });
    });

    it('answers the refreshed issues alone, and says the skipped ones in the log, without report [TASK-R55]', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      fetchPage.mockImplementation(async (url: string) =>
        asked(url) === 1 ? response({}, '', 500) : response(item(asked(url))),
      );
      const refreshed = (await refreshAll(provider, 2)) as unknown[];
      expect(refreshed).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('1 of 2 linked issues could not be refreshed'),
      );
      warn.mockRestore();
    });

    it('stops at a rate limit: the issues not started yet are not read [TASK-R56]', async () => {
      fetchPage.mockImplementation(async (url: string) =>
        asked(url) === 1
          ? response({}, '', 429, { 'retry-after': '60' })
          : response(item(asked(url))),
      );
      const report = (await refreshAll(provider, 8, true)) as {
        issues: unknown[];
        failed: unknown[];
        notRead: number;
        retryAfter: number | null;
      };
      // Four start together; the first is refused, the three beside it
      // finish, and the four after them are left for a later run.
      expect(report.issues).toHaveLength(3);
      expect(report.failed).toEqual([
        {
          externalId: linked(provider, 1).externalId,
          error: 'rate_limited',
          status: 429,
        },
      ]);
      expect(report.notRead).toBe(4);
      expect(report.retryAfter).toBeGreaterThan(Date.now());
    });

    it('stops the whole refresh when its server is stopping', async () => {
      fetchPage.mockRejectedValue(
        new ConnectorError('INTERRUPTED', 'the call was interrupted'),
      );
      await expect(refreshAll(provider, 2, true)).rejects.toMatchObject({
        code: 'INTERRUPTED',
      });
    });
  },
);

describe.each(['github', 'glitchtip'])(
  '%s text the database could not store',
  (provider) => {
    it('drops NUL characters from what an issue is read with [TASK-R55]', async () => {
      fetchPage.mockResolvedValueOnce(
        response([
          provider === 'github'
            ? {
                ...githubIssue(1),
                title: 'Broken\u0000 title',
                body: 'first\u0000 line',
              }
            : {
                ...glitchtipIssue(1),
                title: 'Broken\u0000 title',
                culprit: 'app\u0000.ts',
                metadata: { value: 'Fail\u0000ed' },
              },
        ]),
      );
      const imported = (await run(provider)) as {
        issues: {
          title: string;
          description: string;
          externalIssue: { title: string; description: string };
        }[];
      };
      const [first] = imported.issues;
      expect(first?.title).toBe('Broken title');
      expect(first?.externalIssue.title).toBe('Broken title');
      expect(JSON.stringify(first)).not.toContain('\\u0000');
    });

    it('names an issue whose title is nothing but NUL characters by its number [TASK-R55]', async () => {
      fetchPage.mockResolvedValueOnce(
        response([
          provider === 'github'
            ? { ...githubIssue(7), title: '\u0000' }
            : { ...glitchtipIssue(7), title: '\u0000' },
        ]),
      );
      const imported = (await run(provider)) as {
        issues: { title: string; externalIssue: { title: string } }[];
      };
      expect(imported.issues[0]?.title).toMatch(/7/);
      expect(imported.issues[0]?.externalIssue.title).toBe(
        imported.issues[0]?.title,
      );
    });
  },
);

describe.each(['github', 'glitchtip'])(
  '%s answers that are not JSON',
  (provider) => {
    it('fails without quoting the answer [TASK-R53]', async () => {
      fetchPage.mockResolvedValue({
        status: 200,
        headers: { link: '' },
        json: () => {
          throw new Error(
            'response body is not JSON (status 200, content-type text/html): <html>internal build 4711</html>',
          );
        },
        text: () => '<html>internal build 4711</html>',
      });
      const failure = await run(provider).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'INPUT_INVALID' });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain('4711');
      expect((failure as Error).message).toContain('HTTP 200');
    });
  },
);

describe('GitHub pull request intake', () => {
  function pullRequest(number: number, login = 'renovate[bot]') {
    return {
      ...githubIssue(number),
      title: `Update dependency ${number}`,
      html_url: `https://github.com/Example/Web/pull/${number}`,
      pull_request: { url: `https://api.github.com/pulls/${number}` },
      user: { login },
    };
  }

  it('reads the open pull requests one login opened, and leaves the issues out [TASK-R64]', async () => {
    fetchPage.mockResolvedValueOnce(
      response([
        { ...githubIssue(1), user: { login: 'renovate[bot]' } },
        pullRequest(2),
        pullRequest(3, 'octocat'),
        pullRequest(4, 'Renovate[bot]'),
      ]),
    );
    const imported = (await run('github', {
      type: 'pulls',
      author: 'renovate[bot]',
    })) as {
      issues: Array<{ externalId: string; externalUrl: string }>;
      legacyPrefixes?: string[];
    };
    expect(imported.issues).toEqual([
      expect.objectContaining({
        externalId: 'example/web#2',
        externalUrl: 'https://github.com/Example/Web/pull/2',
      }),
      expect.objectContaining({ externalId: 'example/web#4' }),
    ]);
    // A pull request listing has no tasks from before snapshots to adopt.
    expect(imported).not.toHaveProperty('legacyPrefixes');
    expect(fetchPage.mock.calls[0]?.[0]).toContain('creator=renovate%5Bbot%5D');
  });

  it('reads the issues one login opened, and leaves the pull requests out [TASK-R64]', async () => {
    fetchPage.mockResolvedValueOnce(
      response([
        { ...githubIssue(1), user: { login: 'mia' } },
        { ...githubIssue(2), user: { login: 'noah' } },
        pullRequest(3, 'mia'),
      ]),
    );
    await expect(run('github', { author: 'mia' })).resolves.toMatchObject({
      issues: [{ externalId: 'example/web#1' }],
    });
  });

  it('keeps an issue cursor out of a pull request listing [TASK-R64]', async () => {
    fetchPage.mockResolvedValue(response([githubIssue(1), githubIssue(2)]));
    const first = (await run('github', { limit: 1 })) as { nextCursor: string };
    await expect(
      run('github', { type: 'pulls', cursor: first.nextCursor }),
    ).rejects.toThrow(/another source or filter/);
  });

  it('refuses a pull request whose link is an issue’s, and an issue whose link is a pull request’s', async () => {
    fetchPage.mockResolvedValueOnce(
      response([
        {
          ...pullRequest(2),
          html_url: 'https://github.com/Example/Web/issues/2',
        },
      ]),
    );
    await expect(run('github', { type: 'pulls' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    fetchPage.mockResolvedValueOnce(
      response([
        {
          ...githubIssue(1),
          html_url: 'https://github.com/Example/Web/pull/1',
        },
      ]),
    );
    await expect(run('github')).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('reads a linked pull request again, merged or closed [TASK-R64]', async () => {
    fetchPage.mockResolvedValueOnce(
      response({ ...pullRequest(2), state: 'closed' }),
    );
    await expect(
      refresh('github', {
        externalId: 'example/web#2',
        externalIssue: {
          ...source('github').externalIssue,
          id: '1002',
          number: 2,
          url: 'https://github.com/Example/Web/pull/2',
        },
      }),
    ).resolves.toMatchObject({
      externalUrl: 'https://github.com/Example/Web/pull/2',
      externalIssue: { id: '1002', state: 'closed' },
    });
  });

  it.each(['a b', 'renovate[app]'])(
    'refuses the author %j before GitHub is asked',
    async (author) => {
      await expect(run('github', { author })).rejects.toMatchObject({
        code: 'INPUT_INVALID',
      });
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );
});
