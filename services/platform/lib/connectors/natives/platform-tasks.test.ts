import { describe, expect, it, vi } from 'vitest';

import { platformTaskNatives } from './platform-tasks';

const bodies = {
  en: 'Checked.',
  de: 'Geprüft.',
  fr: 'Vérifié.',
  'de-CH': 'Geprüft.',
  nl: 'Gecontroleerd.',
  it: 'Verificato.',
};

describe('localized workflow task comments', () => {
  it('returns locale maps after filtering the native comment window', async () => {
    const listComments = vi.fn().mockResolvedValue({
      comments: [
        {
          authorType: 'agent',
          authorId: 'workflow',
          body: 'anchor',
          createdAt: 1,
        },
        {
          authorType: 'agent',
          authorId: 'workflow',
          body: 'Geprüft.',
          bodyByLocale: bodies,
          createdAt: 2,
        },
      ],
      truncated: false,
    });
    const native = platformTaskNatives({ listComments } as never)[
      'task.list_comments'
    ];
    await expect(
      native?.(
        {
          taskId: 't-1',
          afterMarker: 'anchor',
          authorTypes: ['agent'],
          limit: 1,
        },
        { organizationId: 'org-1' } as never,
      ),
    ).resolves.toMatchObject({
      count: 1,
      comments: [{ body: 'Geprüft.', bodyByLocale: bodies }],
    });
  });

  it('accepts and preserves extra UI language and regional translations', async () => {
    const comment = vi.fn().mockResolvedValue({ messageId: 'm-1' });
    const native = platformTaskNatives({ comment } as never)['task.comment'];
    await expect(
      native?.({ taskId: 't-1', body: 'Geprüft.', bodyByLocale: bodies }, {
        organizationId: 'org-1',
      } as never),
    ).resolves.toEqual({ messageId: 'm-1' });
    expect(comment).toHaveBeenCalledWith({
      organizationId: 'org-1',
      taskId: 't-1',
      body: 'Geprüft.',
      bodyByLocale: bodies,
    });
  });

  it.each([
    { en: 'Checked.', de: 'Geprüft.' },
    { ...bodies, invalid_locale: 'No.' },
    { ...bodies, nl: 42 },
    {
      ...bodies,
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `a${String.fromCharCode(97 + index)}`,
          'Translated.',
        ]),
      ),
    },
  ])(
    'refuses incomplete or invalid locale maps before writing',
    async (bodyByLocale) => {
      const comment = vi.fn();
      const native = platformTaskNatives({ comment } as never)['task.comment'];
      await expect(
        native?.({ taskId: 't-1', body: 'Checked.', bodyByLocale }, {
          organizationId: 'org-1',
        } as never),
      ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
      expect(comment).not.toHaveBeenCalled();
    },
  );
});

describe('external issue task intake', () => {
  const input = {
    projectId: 'project-1',
    externalSystem: 'github',
    externalId: 'example/web#1',
    title: 'Issue',
    externalUrl: 'https://github.com/example/web/issues/1',
  };

  it('takes organization and caller from the trusted context', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ taskId: 'task-1', created: true });
    const native = platformTaskNatives({ upsert } as never)['task.upsert'];
    const caller = { kind: 'workflow', runId: 'run-1', nodeId: 'tasks' };
    await expect(
      native?.(input, { organizationId: 'org-1', caller } as never),
    ).resolves.toEqual({ taskId: 'task-1', created: true, title: 'Issue' });
    expect(upsert).toHaveBeenCalledWith({
      ...input,
      organizationId: 'org-1',
      caller,
    });
  });

  it.each([
    { ...input, projectId: ' ' },
    { ...input, externalId: '' },
    { ...input, externalUrl: 'javascript:alert(1)' },
    { ...input, externalState: 'closed' },
    { ...input, organizationId: 'foreign' },
    { ...input, description: 'x'.repeat(100001) },
  ])('rejects invalid input before writing', async (invalid) => {
    const upsert = vi.fn();
    const native = platformTaskNatives({ upsert } as never)['task.upsert'];
    await expect(
      native?.(invalid, { organizationId: 'org-1' } as never),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a missing caller even with valid input', async () => {
    const upsert = vi.fn();
    await expect(
      platformTaskNatives({ upsert } as never)['task.upsert']?.(input, {
        organizationId: 'org-1',
      } as never),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
