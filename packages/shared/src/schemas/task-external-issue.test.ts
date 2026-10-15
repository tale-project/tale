import { describe, expect, it } from 'vitest';

import {
  ISSUE_TRACKER_SYSTEMS,
  isIssueTrackerSystem,
  isPullRequestUrl,
  issueSourceScope,
  issueTracker,
  issueTrackersScopedBy,
  taskExternalIssueSchema,
} from './task-external-issue';

const source = {
  id: 'https://errors.example.test#42',
  title: 'Upstream title',
  description: '',
  url: 'https://errors.example.test/organizations/sample/issues/42',
  state: 'resolved',
  syncedAt: 1790400000000,
};

describe('external issue snapshot boundary', () => {
  it('keeps source identity and resolution separate from Tale task fields', () => {
    expect(
      taskExternalIssueSchema.parse({
        ...source,
        sourceProjectId: '17',
        unavailable: true,
      }),
    ).toEqual({
      ...source,
      sourceProjectId: '17',
      unavailable: true,
    });
    expect(
      taskExternalIssueSchema.safeParse({ ...source, status: 'done' }).success,
    ).toBe(false);
    expect(
      taskExternalIssueSchema.safeParse({ ...source, id: ' ' }).success,
    ).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/source',
    '/issues/42',
  ])('refuses unsafe or relative source links: %s', (url) =>
    expect(taskExternalIssueSchema.safeParse({ ...source, url }).success).toBe(
      false,
    ),
  );

  it.each([
    -1,
    1.2,
    8_640_000_000_000_001,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
  ])('refuses invalid observation timestamps: %s', (syncedAt) =>
    expect(
      taskExternalIssueSchema.safeParse({ ...source, syncedAt }).success,
    ).toBe(false),
  );

  it('requires lossless positive GitHub locators and an ISO source timestamp', () => {
    expect(
      taskExternalIssueSchema.safeParse({
        ...source,
        repositoryId: 100,
        number: 42,
        updatedAt: '2026-09-26T10:00:00Z',
      }).success,
    ).toBe(true);
    for (const patch of [
      { repositoryId: 0 },
      { number: 2.5 },
      { repositoryId: Number.MAX_SAFE_INTEGER + 1 },
      { updatedAt: 'yesterday' },
    ]) {
      expect(
        taskExternalIssueSchema.safeParse({ ...source, ...patch }).success,
      ).toBe(false);
    }
  });
});

describe('the trackers the issue sync reads', () => {
  it('knows each by the system its tasks carry, and nothing else', () => {
    expect(ISSUE_TRACKER_SYSTEMS).toEqual([
      'github',
      'github-security',
      'forgejo',
      'glitchtip',
    ]);
    for (const system of ISSUE_TRACKER_SYSTEMS)
      expect(isIssueTrackerSystem(system)).toBe(true);
    for (const other of ['crm', 'GitHub', 'toString', '', null, undefined])
      expect(isIssueTrackerSystem(other)).toBe(false);
  });

  it('finds a code host’s issues by repository and an error tracker’s by project', () => {
    expect(issueTrackersScopedBy('repositoryId')).toEqual([
      'github',
      'github-security',
      'forgejo',
    ]);
    expect(issueTrackersScopedBy('sourceProjectId')).toEqual(['glitchtip']);
    const issue = taskExternalIssueSchema.parse({
      ...source,
      repositoryId: 30,
      sourceProjectId: '17',
    });
    expect(issueSourceScope('forgejo', issue)).toBe('30');
    expect(issueSourceScope('glitchtip', issue)).toBe('17');
    expect(issueSourceScope('crm', issue)).toBeUndefined();
  });

  it('names the trackers each connection names an instance of', () => {
    expect(
      ISSUE_TRACKER_SYSTEMS.filter(
        (system) => issueTracker(system)?.perInstance === true,
      ),
    ).toEqual(['forgejo', 'glitchtip']);
  });

  it.each([
    ['https://github.com/acme/web/pull/7', true],
    ['https://git.example.org/acme/web/pulls/7', true],
    ['https://github.com/acme/web/issues/7', false],
    ['https://github.com/acme/web/security/dependabot/7', false],
    ['https://github.com/acme/pull/web/issues/7', false],
  ])('reads %s as a pull request: %s', (url, expected) => {
    expect(isPullRequestUrl(url)).toBe(expected);
  });
});
