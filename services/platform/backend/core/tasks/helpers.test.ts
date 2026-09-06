import { describe, expect, it } from 'vitest';

import {
  TASK_TITLE_MAX,
  taskWorkflowSubjectInput,
  truncateImportedTitle,
} from './helpers';

describe('truncateImportedTitle', () => {
  it('keeps a title within the limit verbatim (trimmed)', () => {
    expect(truncateImportedTitle('  Fix the build  ')).toBe('Fix the build');
  });

  it('truncates an over-long title to the limit with an ellipsis', () => {
    const long = 'x'.repeat(TASK_TITLE_MAX + 40);
    const truncated = truncateImportedTitle(long);
    expect(truncated).toHaveLength(TASK_TITLE_MAX);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('answers an empty string for a blank title', () => {
    expect(truncateImportedTitle('   ')).toBe('');
  });
});

describe('taskWorkflowSubjectInput', () => {
  it('derives the issue number and repo from an issue external id', () => {
    expect(
      taskWorkflowSubjectInput({
        _id: 't-1',
        title: 'Bug',
        status: 'todo',
        projectId: 'p-1',
        externalSystem: 'github',
        externalId: 'acme/widgets#42',
        externalUrl: 'https://github.com/acme/widgets/issues/42',
      }),
    ).toEqual({
      task: {
        id: 't-1',
        title: 'Bug',
        status: 'todo',
        projectId: 'p-1',
        externalSystem: 'github',
        externalId: 'acme/widgets#42',
        externalUrl: 'https://github.com/acme/widgets/issues/42',
        issueNumber: 42,
        repo: 'acme/widgets',
      },
    });
  });

  it('elides the external trio and derived fields for a plain task', () => {
    expect(
      taskWorkflowSubjectInput({
        _id: 't-2',
        title: 'Plain',
        status: 'backlog',
        projectId: 'p-1',
      }),
    ).toEqual({
      task: { id: 't-2', title: 'Plain', status: 'backlog', projectId: 'p-1' },
    });
  });
});
