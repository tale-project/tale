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
