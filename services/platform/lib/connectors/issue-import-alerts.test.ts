import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IssueSourceHttpError } from './natives/issue-import';
import {
  alertLanes,
  alertLevel,
  alertState,
  securityAlert,
  securityAlertNatives,
} from './natives/issue-import-alerts';

/**
 * The GitHub security alert reader over a fake GitHub: the repository
 * lookup answers from here, every alert page and alert from `fetchPage`.
 */

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

const http = {
  get: async (url: string, options: unknown) =>
    url === 'https://api.github.com/repos/Example/Web'
      ? response({ id: 10, full_name: 'example/web' })
      : fetchPage(url, options),
};

function codeScanning(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    state: 'open',
    html_url: `https://github.com/example/web/security/code-scanning/${number}`,
    updated_at: '2026-10-14T18:00:00Z',
    rule: {
      id: 'js/sql-injection',
      name: 'SqlInjection',
      description: 'Database query built from user-controlled sources',
      severity: 'error',
      security_severity_level: 'high',
      help: 'Use parameterized queries.',
    },
    tool: { name: 'CodeQL' },
    most_recent_instance: {
      ref: 'refs/heads/main',
      message: { text: 'This query depends on a user-provided value.' },
      location: { path: 'src/db.ts', start_line: 42 },
    },
    ...overrides,
  };
}

function dependabot(number: number) {
  return {
    number,
    state: 'open',
    html_url: `https://github.com/example/web/security/dependabot/${number}`,
    updated_at: '2026-10-14T18:00:00Z',
    dependency: {
      package: { ecosystem: 'npm', name: 'lodash' },
      manifest_path: 'package.json',
    },
    security_advisory: {
      ghsa_id: 'GHSA-xxxx-yyyy-zzzz',
      cve_id: 'CVE-2026-0001',
      summary: 'Prototype pollution',
      description: 'A long advisory.',
      severity: 'high',
    },
    security_vulnerability: {
      severity: 'high',
      vulnerable_version_range: '< 4.17.21',
      first_patched_version: { identifier: '4.17.21' },
    },
  };
}

const SECRET = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';

function secretScanning(
  number: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    number,
    state: 'open',
    resolution: null,
    html_url: `https://github.com/example/web/security/secret-scanning/${number}`,
    updated_at: '2026-10-14T18:00:00Z',
    secret_type: 'github_personal_access_token',
    secret_type_display_name: 'GitHub Personal Access Token',
    secret: SECRET,
    validity: 'active',
    first_location_detected: { path: '.env', start_line: 3 },
    ...overrides,
  };
}

function list(input: Record<string, unknown>) {
  return securityAlertNatives()['github.list_import_alerts']?.(
    { owner: 'Example', repo: 'Web', ...input },
    { http } as never,
  );
}

/** The listing a request asked for: kind and filters. */
function asked(call: unknown[] | undefined) {
  const url = new URL(String(call?.[0]));
  return {
    kind: url.pathname.split('/')[4],
    ...Object.fromEntries(
      [...url.searchParams].filter(
        ([name]) =>
          !['state', 'sort', 'direction', 'per_page', 'page'].includes(name),
      ),
    ),
  };
}

beforeEach(() => vi.resetAllMocks());

describe('the listings a security source is read through', () => {
  it('reads code scanning per tool and severity at or above its floor, one scale over GitHub’s two [TASK-R65]', () => {
    expect(
      alertLanes({
        alerts: ['secret-scanning', 'code-scanning', 'dependabot'],
        minSeverity: 'high',
        tools: ['Trivy', 'CodeQL', 'Trivy'],
      }),
    ).toEqual([
      { kind: 'code-scanning', tool: 'CodeQL', severity: 'critical' },
      { kind: 'code-scanning', tool: 'CodeQL', severity: 'high' },
      { kind: 'code-scanning', tool: 'CodeQL', severity: 'error' },
      { kind: 'code-scanning', tool: 'Trivy', severity: 'critical' },
      { kind: 'code-scanning', tool: 'Trivy', severity: 'high' },
      { kind: 'code-scanning', tool: 'Trivy', severity: 'error' },
      { kind: 'dependabot', severities: 'critical,high' },
      { kind: 'secret-scanning' },
    ]);
  });

  it('reads every alert of a kind without a floor or tools [TASK-R65]', () => {
    expect(alertLanes({ alerts: ['code-scanning', 'dependabot'] })).toEqual([
      { kind: 'code-scanning' },
      { kind: 'dependabot' },
    ]);
    expect(
      alertLanes({ alerts: ['code-scanning'], minSeverity: 'medium' }),
    ).toEqual(
      ['critical', 'high', 'error', 'medium', 'warning'].map((severity) => ({
        kind: 'code-scanning',
        severity,
      })),
    );
  });
});

describe('a security alert as a task takes it', () => {
  it('names a code scanning alert by its rule and place, with its facts [TASK-R65]', () => {
    expect(securityAlert('code-scanning', codeScanning(7), 10)).toEqual({
      externalSystem: 'github-security',
      externalId: 'example/web/code-scanning#7',
      externalUrl: 'https://github.com/example/web/security/code-scanning/7',
      title:
        'Database query built from user-controlled sources in src/db.ts:42',
      description: [
        '- Tool: CodeQL',
        '- Rule: js/sql-injection',
        '- Severity: high',
        '- Location: src/db.ts:42',
        '- Branch: refs/heads/main',
        '- Message: This query depends on a user-provided value.',
        '',
        'Use parameterized queries.',
      ].join('\n'),
      externalIssue: expect.objectContaining({
        id: '10/code-scanning/7',
        state: 'open',
        repositoryId: 10,
        number: 7,
        updatedAt: '2026-10-14T18:00:00Z',
      }),
    });
  });

  it('names a Dependabot alert by its advisory and package', () => {
    expect(securityAlert('dependabot', dependabot(3), 10)).toMatchObject({
      externalId: 'example/web/dependabot#3',
      title: 'Prototype pollution in lodash',
      description: expect.stringContaining('- Patched in: 4.17.21'),
      externalIssue: { id: '10/dependabot/3' },
    });
  });

  it('names a secret by its kind and place, and never keeps the secret [TASK-R65]', () => {
    const alert = securityAlert('secret-scanning', secretScanning(2), 10);
    expect(alert).toMatchObject({
      title: 'GitHub Personal Access Token exposed in .env:3',
      externalIssue: { id: '10/secret-scanning/2' },
    });
    expect(JSON.stringify(alert)).not.toContain(SECRET);
  });

  it.each([
    ['code-scanning', 'open', null, 'open'],
    ['code-scanning', 'fixed', null, 'resolved'],
    ['code-scanning', 'dismissed', null, 'ignored'],
    ['dependabot', 'auto_dismissed', null, 'ignored'],
    ['dependabot', 'fixed', null, 'resolved'],
    ['secret-scanning', 'resolved', 'revoked', 'resolved'],
    ['secret-scanning', 'resolved', 'false_positive', 'ignored'],
    ['secret-scanning', 'resolved', 'used_in_tests', 'ignored'],
    ['secret-scanning', 'resolved', 'pattern_edited', 'closed'],
    ['code-scanning', 'closed', null, 'closed'],
  ] as const)(
    'reads a %s alert %s (%s) as %s [TASK-R65]',
    (kind, state, resolution, expected) => {
      expect(alertState(kind, state, resolution)).toBe(expected);
    },
  );

  it.each([
    'https://github.example.com/example/web/security/code-scanning/7',
    'https://github.com/example/web/security/dependabot/7',
    'https://github.com/example/web/security/code-scanning/8',
  ])('refuses an alert whose link is not its own: %s', (html_url) => {
    expect(() =>
      securityAlert('code-scanning', codeScanning(7, { html_url }), 10),
    ).toThrow(/invalid security alert URL/);
  });
});

describe('GitHub security alert intake', () => {
  it('asks GitHub for each listing with its own filters, and walks them in order [TASK-R65]', async () => {
    fetchPage.mockImplementation(async (url: string) => {
      const kind = new URL(url).pathname.split('/')[4];
      if (kind === 'code-scanning')
        return response(
          new URL(url).searchParams.get('severity') === 'high'
            ? [codeScanning(7)]
            : [],
        );
      if (kind === 'dependabot') return response([dependabot(3)]);
      return response([secretScanning(2)]);
    });
    const imported = (await list({
      alerts: ['secret-scanning', 'dependabot', 'code-scanning'],
      minSeverity: 'high',
      tools: ['CodeQL'],
    })) as {
      issues: Array<{ externalId: string }>;
      repositoryId: number;
      repository: string;
      nextCursor: string | null;
    };
    expect(imported.issues.map((issue) => issue.externalId)).toEqual([
      'example/web/code-scanning#7',
      'example/web/dependabot#3',
      'example/web/secret-scanning#2',
    ]);
    expect(imported).toMatchObject({
      repositoryId: 10,
      repository: 'example/web',
      nextCursor: null,
    });
    expect(fetchPage.mock.calls.map((call) => asked(call))).toEqual([
      { kind: 'code-scanning', tool_name: 'CodeQL', severity: 'critical' },
      { kind: 'code-scanning', tool_name: 'CodeQL', severity: 'high' },
      { kind: 'code-scanning', tool_name: 'CodeQL', severity: 'error' },
      { kind: 'dependabot', severity: 'critical,high' },
      { kind: 'secret-scanning', hide_secret: 'true' },
    ]);
    expect(JSON.stringify(imported)).not.toContain(SECRET);
  });

  it('leaves out an alert of another tool or under the floor that a listing answered anyway [TASK-R65]', async () => {
    fetchPage.mockImplementation(async (url: string) =>
      new URL(url).searchParams.get('severity') === 'critical'
        ? response([
            codeScanning(1, { tool: { name: 'Trivy' } }),
            codeScanning(2, {
              rule: { ...codeScanning(2).rule, security_severity_level: 'low' },
            }),
            codeScanning(3, {
              rule: {
                ...codeScanning(3).rule,
                security_severity_level: 'critical',
              },
            }),
          ])
        : response([]),
    );
    const imported = (await list({
      alerts: ['code-scanning'],
      minSeverity: 'critical',
      tools: ['CodeQL'],
    })) as { issues: Array<{ externalId: string }> };
    expect(imported.issues.map((issue) => issue.externalId)).toEqual([
      'example/web/code-scanning#3',
    ]);
  });

  it.each([
    [
      'code-scanning',
      { rule: { security_severity_level: 'medium', severity: 'error' } },
      'medium',
    ],
    ['code-scanning', { rule: { severity: 'error' } }, 'high'],
    ['code-scanning', { rule: { severity: 'warning' } }, 'medium'],
    ['code-scanning', { rule: { severity: 'note' } }, 'low'],
    ['code-scanning', { rule: { severity: 'none' } }, null],
    ['dependabot', { security_advisory: { severity: 'high' } }, 'high'],
    ['secret-scanning', {}, 'critical'],
  ] as const)(
    'reads a %s alert %j at level %s [TASK-R65]',
    (kind, row, level) => {
      expect(alertLevel(kind, row)).toBe(level);
    },
  );

  it('follows Dependabot’s cursor, which pages by `after` alone', async () => {
    fetchPage.mockResolvedValueOnce(
      response(
        [dependabot(1)],
        '<https://api.github.com/repositories/10/dependabot/alerts?per_page=100&after=Y3Vyc29y>; rel="next"',
      ),
    );
    fetchPage.mockResolvedValueOnce(response([dependabot(2)]));
    await expect(list({ alerts: ['dependabot'] })).resolves.toMatchObject({
      issues: [
        { externalId: 'example/web/dependabot#1' },
        { externalId: 'example/web/dependabot#2' },
      ],
      nextCursor: null,
    });
    const second = new URL(String(fetchPage.mock.calls[1]?.[0]));
    expect(second.searchParams.get('after')).toBe('Y3Vyc29y');
    expect(second.searchParams.has('page')).toBe(false);
  });

  it('carries on in the listing it stopped in, from the alert after the last one taken [TASK-R65]', async () => {
    fetchPage.mockImplementation(async (url: string) =>
      new URL(url).pathname.includes('code-scanning')
        ? response([codeScanning(1), codeScanning(2)])
        : response([dependabot(3)]),
    );
    const first = (await list({
      alerts: ['code-scanning', 'dependabot'],
      limit: 1,
    })) as { nextCursor: string };
    const second = (await list({
      alerts: ['code-scanning', 'dependabot'],
      limit: 2,
      cursor: first.nextCursor,
    })) as { issues: Array<{ externalId: string }>; nextCursor: unknown };
    expect(second.issues.map((issue) => issue.externalId)).toEqual([
      'example/web/code-scanning#2',
      'example/web/dependabot#3',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('starts over when the filter changed under its cursor [TASK-R65]', async () => {
    fetchPage.mockResolvedValue(response([codeScanning(1), codeScanning(2)]));
    const first = (await list({ alerts: ['code-scanning'], limit: 1 })) as {
      nextCursor: string;
    };
    await expect(
      list({
        alerts: ['code-scanning'],
        tools: ['Trivy'],
        cursor: first.nextCursor,
      }),
    ).rejects.toThrow(/another source or filter/);
  });

  it('fails a listing GitHub refuses with its status', async () => {
    fetchPage.mockResolvedValueOnce(response({}, '', 403));
    const failure = await Promise.resolve(
      list({ alerts: ['code-scanning'] }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IssueSourceHttpError);
    expect(failure).toMatchObject({ status: 403, retryAfter: null });
  });

  it.each([
    [{ alerts: [] }],
    [{ alerts: ['issues'] }],
    [{ alerts: ['code-scanning'], minSeverity: 'error' }],
    [{ alerts: ['code-scanning'], tools: ['Code&QL'] }],
  ])('refuses %j before GitHub is asked', async (input) => {
    await expect(list(input)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('GitHub security alert refresh', () => {
  const linked = (kind: string, number: number) => ({
    externalId: `example/web/${kind}#${number}`,
    externalIssue: {
      id: `10/${kind}/${number}`,
      title: 'Original',
      description: 'Original',
      url: `https://github.com/example/web/security/${kind}/${number}`,
      state: 'open',
      syncedAt: 1,
      repositoryId: 10,
      number,
    },
  });

  it('reads a fixed alert again as resolved, and leaves the secret hidden [TASK-R65]', async () => {
    fetchPage.mockImplementation(async (url: string) =>
      url.includes('/secret-scanning/')
        ? response(
            secretScanning(2, { state: 'resolved', resolution: 'revoked' }),
          )
        : response(codeScanning(7, { state: 'fixed' })),
    );
    const report = (await securityAlertNatives()[
      'github.refresh_import_alerts'
    ]?.(
      {
        issues: [linked('code-scanning', 7), linked('secret-scanning', 2)],
        repository: 'example/web',
        repositoryId: 10,
        report: true,
      },
      { http } as never,
    )) as {
      issues: Array<{ externalIssue: { id: string; state: string } }>;
    };
    expect(
      report.issues.map((issue) => [
        issue.externalIssue.id,
        issue.externalIssue.state,
      ]),
    ).toEqual([
      ['10/code-scanning/7', 'resolved'],
      ['10/secret-scanning/2', 'resolved'],
    ]);
    expect(fetchPage.mock.calls.map((call) => String(call[0])).sort()).toEqual([
      'https://api.github.com/repos/example/web/code-scanning/alerts/7',
      'https://api.github.com/repos/example/web/secret-scanning/alerts/2?hide_secret=true',
    ]);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('marks an alert GitHub no longer has unavailable', async () => {
    fetchPage.mockResolvedValueOnce(response({}, '', 404));
    await expect(
      securityAlertNatives()['github.get_import_alert']?.(
        { issue: linked('dependabot', 3), repository: 'example/web' },
        { http } as never,
      ),
    ).resolves.toMatchObject({
      externalIssue: { id: '10/dependabot/3', unavailable: true },
    });
  });

  it('refuses an alert of another repository', async () => {
    await expect(
      securityAlertNatives()['github.get_import_alert']?.(
        {
          issue: linked('dependabot', 3),
          repository: 'example/web',
          repositoryId: 11,
        },
        { http } as never,
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
