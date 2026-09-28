import { describe, expect, it } from 'vitest';

import {
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_TITLE_MAX,
  taskCommentRefusal,
  taskDescriptionRefusal,
  taskLabelCountRefusal,
  taskLabelNameRefusal,
  taskLimitText,
  taskTitleRefusal,
  taskWorkflowSubjectInput,
  importedTaskTitleRefusal,
  truncateImportedDescription,
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

describe('truncateImportedDescription', () => {
  it('keeps a description within the cap verbatim (trimmed)', () => {
    const fits = 'd'.repeat(TASK_DESCRIPTION_MAX);
    expect(truncateImportedDescription(`\n${fits}  `)).toBe(fits);
  });

  it('cuts an over-long description to the cap, ending in an ellipsis', () => {
    const cut = truncateImportedDescription(
      `${'d'.repeat(TASK_DESCRIPTION_MAX)} and more`,
    );
    expect(cut).toHaveLength(TASK_DESCRIPTION_MAX);
    expect(cut).toBe(`${'d'.repeat(TASK_DESCRIPTION_MAX - 1)}…`);
    // The same rule the title's cut follows.
    expect(truncateImportedDescription('x'.repeat(50_000))).toHaveLength(
      TASK_DESCRIPTION_MAX,
    );
  });

  it('answers an empty string for a blank description', () => {
    expect(truncateImportedDescription(' \n ')).toBe('');
  });
});

describe('the imported cut never splits a grapheme', () => {
  const cuts = [
    ['title', truncateImportedTitle, TASK_TITLE_MAX],
    ['description', truncateImportedDescription, TASK_DESCRIPTION_MAX],
  ] as const;

  // 🎯 is two UTF-16 code units: a cut after its first half would leave a
  // lone surrogate, which storage writes as U+FFFD.
  it.each(cuts)(
    'steps back before a pair the %s cut lands in',
    (_, cut, max) => {
      // The first half of an emoji sits at max - 2, where the cut ends.
      const text = `${'a'.repeat(max - 2)}🎯${'b'.repeat(10)}`;
      const result = cut(text);
      expect(result).toBe(`${'a'.repeat(max - 2)}…`);
      expect(result.isWellFormed()).toBe(true);
    },
  );

  it.each(cuts)(
    'keeps a whole emoji that ends where the %s cut ends',
    (_, cut, max) => {
      const text = `${'a'.repeat(max - 3)}🎯${'b'.repeat(10)}`;
      expect(cut(text)).toBe(`${'a'.repeat(max - 3)}🎯…`);
      expect(cut(text)).toHaveLength(max);
    },
  );

  /*
   * One grapheme a reader sees as one character, made of several code
   * points (spelled as escapes: the joiners and marks are invisible). The
   * cut used to step back from a lone high surrogate only, so each of these,
   * straddling the cut, lost its tail: the family became a man, the flag a
   * lone regional indicator, the thumb lost its skin tone, the keycap its
   * frame and the letter its accent.
   */
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  const graphemes = [
    ['a ZWJ family', family],
    ['a flag', '\u{1F1E8}\u{1F1ED}'],
    ['a skin-tone modifier', '\u{1F44D}\u{1F3FD}'],
    ['a keycap', '1\uFE0F\u20E3'],
    ['a combining mark', 'e\u0301'],
  ] as const;

  it('reads each of those as one grapheme of several code points', () => {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });
    for (const [, grapheme] of graphemes) {
      expect([...segmenter.segment(grapheme)]).toHaveLength(1);
      expect(grapheme.length).toBeGreaterThan(1);
    }
  });

  describe.each(cuts)('the %s cut', (_, cut, max) => {
    it.each(graphemes)('drops %s it lands inside, whole', (__, grapheme) => {
      // Every start that puts unit max - 1 inside the grapheme: part of it
      // would fit before the "…", and its tail runs past it.
      for (let start = max - grapheme.length; start <= max - 2; start += 1) {
        const kept = 'a'.repeat(start);
        const result = cut(`${kept}${grapheme}${'b'.repeat(10)}`);
        expect(result).toBe(`${kept}…`);
        expect(result.isWellFormed()).toBe(true);
      }
    });

    it.each(graphemes)('keeps %s that ends where it ends', (__, grapheme) => {
      const kept = `${'a'.repeat(max - 1 - grapheme.length)}${grapheme}`;
      const result = cut(`${kept}${'b'.repeat(10)}`);
      expect(result).toBe(`${kept}…`);
      expect(result).toHaveLength(max);
    });
  });

  it('drops a ZWJ family whose first person alone would still fit', () => {
    // The man ends at max - 1, where the old cut stopped: it kept him and
    // dropped the rest of the family.
    const kept = 'a'.repeat(TASK_TITLE_MAX - 3);
    expect(truncateImportedTitle(`${kept}${family} and more`)).toBe(`${kept}…`);
  });

  it('leaves only the ellipsis when one grapheme alone is over the cap', () => {
    // A letter under 250 combining marks is one grapheme of 251 code units.
    const stacked = `Z${'\u0301'.repeat(250)}`;
    expect(truncateImportedTitle(`${stacked} title`)).toBe('…');
  });
});

describe('importedTaskTitleRefusal', () => {
  it('refuses a blank title with the empty sentence every door answers', () => {
    for (const title of ['', '   \n']) {
      expect(importedTaskTitleRefusal(title)).toBe(taskTitleRefusal(title));
    }
    expect(importedTaskTitleRefusal('')).toBe(
      'The task title is empty — it takes 1 to 200 UTF-16 code units.',
    );
  });

  it('never refuses an imported title for its length: the import cuts it', () => {
    expect(importedTaskTitleRefusal('x'.repeat(TASK_TITLE_MAX + 1))).toBeNull();
    expect(importedTaskTitleRefusal('Fits')).toBeNull();
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

/**
 * The refusal sentences every door relays beside a limit's code. They used
 * to be "Invalid title", "Description too long", "Invalid label name" and
 * "Invalid comment body": one sentence for an empty title and an over-long
 * one, and no limit named anywhere. Each now names the cap, its unit and
 * the length measured the way the cap measures it — never the value.
 */
describe('task limit refusals', () => {
  it('states a cap with its unit, grouped the way the sentences print it', () => {
    expect(taskLimitText(TASK_DESCRIPTION_MAX)).toBe(
      '20,000 UTF-16 code units',
    );
    expect(taskLimitText(TASK_TITLE_MAX)).toBe('200 UTF-16 code units');
  });

  it('tells an empty title from an over-long one, naming the limit in both', () => {
    const empty = taskTitleRefusal('');
    expect(empty).toBe(
      'The task title is empty — it takes 1 to 200 UTF-16 code units.',
    );
    // Whitespace-only is measured trimmed, so it is the same empty title.
    expect(taskTitleRefusal('  \n\t ')).toBe(empty);

    const long = 'Q'.repeat(TASK_TITLE_MAX + 1);
    const over = taskTitleRefusal(long);
    expect(over).toBe(
      'The task title is capped at 200 UTF-16 code units (most emoji count ' +
        'as 2); this one has 201.',
    );
    expect(over).not.toContain(long.slice(0, 20));
  });

  it('measures a title trimmed and in UTF-16 code units, as the limit does', () => {
    expect(taskTitleRefusal(`  ${'x'.repeat(TASK_TITLE_MAX)}\n`)).toBeNull();
    // 100 emoji are 200 code units: at the limit, not half of it.
    expect(taskTitleRefusal('🎯'.repeat(TASK_TITLE_MAX / 2))).toBeNull();
    // One more is 202 — and the sentence says 202, not the 101 a person
    // counts, so the length it reports is the length the cap compares.
    expect(taskTitleRefusal('🎯'.repeat(TASK_TITLE_MAX / 2 + 1))).toContain(
      'this one has 202.',
    );
  });

  it('names the description cap and the length sent', () => {
    expect(taskDescriptionRefusal('d'.repeat(TASK_DESCRIPTION_MAX))).toBeNull();
    expect(taskDescriptionRefusal('d'.repeat(TASK_DESCRIPTION_MAX + 431))).toBe(
      'The task description is capped at 20,000 UTF-16 code units (most ' +
        'emoji count as 2); this one has 20,431.',
    );
  });

  it('names the label count cap and each label name cap', () => {
    expect(taskLabelCountRefusal(TASK_LABELS_MAX)).toBeNull();
    expect(taskLabelCountRefusal(TASK_LABELS_MAX + 1)).toBe(
      'A task carries at most 50 labels; 51 were given.',
    );
    expect(taskLabelNameRefusal('l'.repeat(TASK_LABEL_CHARS_MAX))).toBeNull();
    expect(taskLabelNameRefusal('l'.repeat(TASK_LABEL_CHARS_MAX + 14))).toBe(
      'A label name is capped at 50 UTF-16 code units (most emoji count as ' +
        '2); this one has 64.',
    );
    expect(taskLabelNameRefusal('   ')).toBe(
      'A label name is empty — it takes 1 to 50 UTF-16 code units.',
    );
  });

  it('measures a label name as the catalog stores it — NFC-composed', () => {
    // "e" + a combining acute is two code units until NFC composes it into
    // "é": fifty of them are 100 units as sent and 50 as stored.
    const decomposed = 'e\u0301'.repeat(TASK_LABEL_CHARS_MAX);
    expect(decomposed).toHaveLength(TASK_LABEL_CHARS_MAX * 2);
    expect(taskLabelNameRefusal(decomposed)).toBeNull();
  });

  it('tells an empty comment from an over-long one, measured trimmed', () => {
    expect(taskCommentRefusal(' \n ')).toBe(
      'The comment is empty — it takes 1 to 10,000 UTF-16 code units.',
    );
    expect(taskCommentRefusal(` ${'c'.repeat(TASK_COMMENT_MAX)} `)).toBeNull();
    expect(taskCommentRefusal('c'.repeat(TASK_COMMENT_MAX + 1))).toBe(
      'The comment is capped at 10,000 UTF-16 code units (most emoji count ' +
        'as 2); this one has 10,001.',
    );
  });
});
