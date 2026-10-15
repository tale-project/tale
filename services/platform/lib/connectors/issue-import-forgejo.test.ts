import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IssueSourceHttpError } from './natives/issue-import';
import { forgejoIssueNatives } from './natives/issue-import-forgejo';

/**
 * The Forgejo reader over a fake instance: the repository lookups answer
 * from here, every page and issue read from `fetchPage`.
 */

const endpoint = 'https://git.example.org';
const fetchPage = vi.fn();

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

function forgejoIssue(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: number + 100,
    number,
    title: `Issue ${number}`,
    body: 'Details',
    state: 'open',
    html_url: `${endpoint}/example/web/issues/${number}`,
    updated_at: '2026-10-14T18:00:00Z',
    pull_request: null,
    user: { login: 'mia' },
    ...overrides,
  };
}

function pullRequest(number: number, login = 'renovate') {
  return forgejoIssue(number, {
    title: `Update dependency ${number}`,
    html_url: `${endpoint}/example/web/pulls/${number}`,
    pull_request: { merged: false, merged_at: null },
    user: { login },
  });
}

/** The repository's current name, as `/repositories/{id}` answers it. */
let currentName = 'example/web';

const http = {
  get: async (url: string, options: unknown) => {
    if (url === `${endpoint}/api/v1/repos/Example/Web`)
      return response({ id: 30, full_name: 'example/web' });
    if (url === `${endpoint}/api/v1/repositories/30`)
      return response({ id: 30, full_name: currentName });
    return fetchPage(url, options);
  },
};

function list(input: Record<string, unknown> = {}, at = endpoint) {
  return forgejoIssueNatives()['forgejo.list_import_issues']?.(
    { owner: 'Example', repo: 'Web', ...input },
    { endpoint: at, http } as never,
  );
}

function linked(number: number, overrides: Record<string, unknown> = {}) {
  return {
    externalId: `${endpoint}/example/web#${number}`,
    externalIssue: {
      id: `${endpoint}#${number + 100}`,
      title: 'Original',
      description: 'Original body',
      url: `${endpoint}/example/web/issues/${number}`,
      state: 'open',
      syncedAt: 1,
      repositoryId: 30,
      number,
      ...overrides,
    },
  };
}

function refresh(issue: ReturnType<typeof linked>, at = endpoint) {
  return forgejoIssueNatives()['forgejo.get_import_issue']?.({ issue }, {
    endpoint: at,
    http,
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  currentName = 'example/web';
});

describe('Forgejo issue intake', () => {
  it('reads the open issues oldest first, and leaves the pull requests out [TASK-R64]', async () => {
    fetchPage.mockResolvedValueOnce(
      response([forgejoIssue(1), pullRequest(2), forgejoIssue(3)]),
    );
    const imported = (await list()) as {
      issues: Array<Record<string, unknown>>;
      repositoryId: number;
      sourceOrigin: string;
    };
    expect(imported.issues.map((issue) => issue.externalId)).toEqual([
      `${endpoint}/example/web#1`,
      `${endpoint}/example/web#3`,
    ]);
    expect(imported.issues[0]).toMatchObject({
      externalSystem: 'forgejo',
      externalUrl: `${endpoint}/example/web/issues/1`,
      title: 'Issue 1',
      description: 'Details',
      externalIssue: {
        id: `${endpoint}#101`,
        state: 'open',
        repositoryId: 30,
        number: 1,
        updatedAt: '2026-10-14T18:00:00Z',
      },
    });
    expect(imported).toMatchObject({
      repositoryId: 30,
      sourceOrigin: endpoint,
      truncated: false,
      nextCursor: null,
    });
    const asked = new URL(String(fetchPage.mock.calls[0]?.[0]));
    expect(asked.pathname).toBe('/api/v1/repos/example/web/issues');
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      state: 'open',
      type: 'issues',
      sort: 'oldest',
      limit: '50',
      page: '1',
    });
  });

  it('reads the open pull requests one user opened [TASK-R64]', async () => {
    const labels = [{ name: 'dependencies' }, { name: 'UI' }];
    fetchPage.mockResolvedValueOnce(
      response([
        { ...pullRequest(2), labels },
        { ...pullRequest(3, 'mia'), labels },
        forgejoIssue(4, { user: { login: 'renovate' }, labels }),
        { ...pullRequest(5, 'Renovate'), labels },
      ]),
    );
    const imported = (await list({
      type: 'pulls',
      author: 'Renovate',
      labels: ' ui, dependencies ,ui',
    })) as { issues: Array<{ externalUrl: string }> };
    expect(imported.issues.map((issue) => issue.externalUrl)).toEqual([
      `${endpoint}/example/web/pulls/2`,
      `${endpoint}/example/web/pulls/5`,
    ]);
    const asked = new URL(String(fetchPage.mock.calls[0]?.[0]));
    expect(asked.searchParams.get('type')).toBe('pulls');
    expect(asked.searchParams.get('created_by')).toBe('renovate');
    expect(asked.searchParams.get('labels')).toBe('dependencies,ui');
  });

  it('keeps only the items carrying every label named, though the instance ignores a label the repository lacks [TASK-R64]', async () => {
    // Forgejo drops a label name the repository has no label of, and
    // answers as if it had not been asked: here every open issue.
    fetchPage.mockResolvedValueOnce(
      response([
        forgejoIssue(1),
        forgejoIssue(2, { labels: [{ name: 'bug' }] }),
        forgejoIssue(3, { labels: [{ name: 'Bug' }, { name: 'typo' }] }),
        forgejoIssue(4, { labels: [] }),
        forgejoIssue(5, {
          labels: [{ name: 'typo' }, { name: 'bug' }, { name: 'ui' }],
        }),
      ]),
    );
    const imported = (await list({ labels: 'bug, typo' })) as {
      issues: Array<{ externalId: string }>;
    };
    expect(imported.issues.map((issue) => issue.externalId)).toEqual([
      `${endpoint}/example/web#3`,
      `${endpoint}/example/web#5`,
    ]);
    expect(
      new URL(String(fetchPage.mock.calls[0]?.[0])).searchParams.get('labels'),
    ).toBe('bug,typo');
  });

  it('follows the next page the instance links, and a full page without one', async () => {
    fetchPage.mockResolvedValueOnce(
      response(
        [forgejoIssue(1)],
        `<${endpoint}/api/v1/repos/example/web/issues?page=2>; rel="next"`,
      ),
    );
    fetchPage.mockResolvedValueOnce(
      response(Array.from({ length: 50 }, (_, at) => forgejoIssue(at + 2))),
    );
    fetchPage.mockResolvedValueOnce(response([forgejoIssue(52)]));
    const imported = (await list({ limit: 500 })) as { issues: unknown[] };
    expect(imported.issues).toHaveLength(52);
    expect(
      fetchPage.mock.calls.map((call) =>
        new URL(String(call[0])).searchParams.get('page'),
      ),
    ).toEqual(['1', '2', '3']);
  });

  it('continues inside a page from its cursor, and refuses it under another filter', async () => {
    fetchPage.mockResolvedValue(response([forgejoIssue(1), forgejoIssue(2)]));
    const first = (await list({ limit: 1 })) as { nextCursor: string };
    await expect(
      list({ limit: 1, cursor: first.nextCursor }),
    ).resolves.toMatchObject({
      issues: [{ externalIssue: { id: `${endpoint}#102` } }],
      nextCursor: null,
    });
    await expect(
      list({ type: 'pulls', cursor: first.nextCursor }),
    ).rejects.toThrow(/another source or filter/);
  });

  it('builds a link from the connection’s own instance, whatever address the answer names [TASK-R66]', async () => {
    fetchPage.mockResolvedValueOnce(
      response([
        forgejoIssue(1, { html_url: 'https://elsewhere.example/x/y/issues/1' }),
      ]),
    );
    await expect(list()).resolves.toMatchObject({
      issues: [
        {
          externalUrl: `${endpoint}/example/web/issues/1`,
          externalIssue: { url: `${endpoint}/example/web/issues/1` },
        },
      ],
    });
  });

  it('keeps one repository on two instances apart [TASK-R66]', async () => {
    const other = 'https://code.example.net';
    const otherHttp = {
      get: async (url: string) =>
        url === `${other}/api/v1/repos/Example/Web`
          ? response({ id: 30, full_name: 'example/web' })
          : response([forgejoIssue(1)]),
    };
    fetchPage.mockResolvedValueOnce(response([forgejoIssue(1)]));
    const here = (await list()) as {
      issues: Array<{ externalId: string; externalIssue: { id: string } }>;
    };
    const there = (await forgejoIssueNatives()['forgejo.list_import_issues']?.(
      { owner: 'Example', repo: 'Web' },
      { endpoint: other, http: otherHttp } as never,
    )) as {
      issues: Array<{ externalId: string; externalIssue: { id: string } }>;
      sourceOrigin: string;
    };
    expect(here.issues[0]?.externalIssue.id).toBe(`${endpoint}#101`);
    expect(there.issues[0]?.externalIssue.id).toBe(`${other}#101`);
    expect(there.issues[0]?.externalId).not.toBe(here.issues[0]?.externalId);
    expect(there.sourceOrigin).toBe(other);
  });

  it('refuses a connection without an instance', async () => {
    await expect(
      forgejoIssueNatives()['forgejo.list_import_issues']?.(
        { owner: 'example', repo: 'web' },
        { http } as never,
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it.each([
    [{ owner: 'example/x' }],
    [{ type: 'alerts' }],
    [{ author: 'a b' }],
  ])('refuses %j before the instance is asked', async (input) => {
    await expect(list(input)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('says what the token needs when the instance refuses it', async () => {
    fetchPage.mockResolvedValueOnce(response({}, '', 401));
    const failure = await Promise.resolve(list()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(IssueSourceHttpError);
    expect((failure as Error).message).toContain(
      'read:issue and read:repository',
    );
  });

  it('keeps the instance’s rate limit as the wait', async () => {
    fetchPage.mockResolvedValueOnce(
      response({}, '', 429, { 'retry-after': '120' }),
    );
    const failure = await Promise.resolve(list()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(IssueSourceHttpError);
    expect((failure as IssueSourceHttpError).retryAfter).toBeGreaterThan(
      Date.now(),
    );
  });
});

describe('Forgejo refresh of linked issues', () => {
  it('reads an issue again through its repository’s current name, closed or open [TASK-R66]', async () => {
    currentName = 'example/renamed';
    fetchPage.mockResolvedValueOnce(
      response(forgejoIssue(1, { state: 'closed', title: 'Changed upstream' })),
    );
    await expect(refresh(linked(1))).resolves.toMatchObject({
      externalId: `${endpoint}/example/renamed#1`,
      externalUrl: `${endpoint}/example/renamed/issues/1`,
      externalIssue: {
        id: `${endpoint}#101`,
        title: 'Changed upstream',
        state: 'closed',
      },
    });
    expect(String(fetchPage.mock.calls[0]?.[0])).toBe(
      `${endpoint}/api/v1/repos/example/renamed/issues/1`,
    );
  });

  it('marks an issue the instance no longer has unavailable', async () => {
    fetchPage.mockResolvedValueOnce(response({}, '', 404));
    await expect(refresh(linked(1))).resolves.toMatchObject({
      externalIssue: { id: `${endpoint}#101`, unavailable: true },
    });
  });

  it('refuses an issue of another instance [TASK-R66]', async () => {
    await expect(
      refresh(linked(1), 'https://code.example.net'),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('refuses an answer that names another issue', async () => {
    fetchPage.mockResolvedValueOnce(response(forgejoIssue(1, { id: 999 })));
    await expect(refresh(linked(1))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('reads each repository once a refresh, and skips an issue the instance refuses [TASK-R55]', async () => {
    const lookups = vi.fn();
    const counting = {
      get: async (url: string, options: unknown) => {
        if (url === `${endpoint}/api/v1/repositories/30`) lookups(url);
        return http.get(url, options);
      },
    };
    fetchPage.mockImplementation(async (url: string) => {
      const number = Number(url.split('/').at(-1));
      return number === 2
        ? response({}, '', 500)
        : response(forgejoIssue(number));
    });
    const report = await forgejoIssueNatives()[
      'forgejo.refresh_import_issues'
    ]?.({ issues: [linked(1), linked(2), linked(3)], report: true }, {
      endpoint,
      http: counting,
    } as never);
    expect(report).toMatchObject({
      issues: [
        { externalIssue: { id: `${endpoint}#101` } },
        { externalIssue: { id: `${endpoint}#103` } },
      ],
      failed: [
        {
          externalId: `${endpoint}/example/web#2`,
          error: 'unavailable',
          status: 500,
        },
      ],
      notRead: 0,
    });
    expect(lookups).toHaveBeenCalledTimes(1);
  });
});
