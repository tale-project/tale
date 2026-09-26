import { describe, expect, it } from 'vitest';

import { taskExternalIssueSchema } from './task-external-issue';

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
