import { beforeEach, describe, expect, it, vi } from 'vitest';

import { issueImportNatives } from './natives/issue-import';

const fetchPage = vi.fn();
const endpoint = 'https://glitchtip.tale.dev';
function response(rows: unknown, link = '', status = 200) {
  return { status, headers: { link }, json: () => rows };
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

it('hydrates a legacy GitHub reference even after it has closed upstream', async () => {
  fetchPage.mockResolvedValue(response({ ...githubIssue(1), state: 'closed' }));
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
});

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
