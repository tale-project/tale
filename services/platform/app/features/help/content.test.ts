import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import { ALL_LESSON_IDS, HELP_CATEGORIES, findLesson } from './content';

// The curriculum table addresses its copy through dynamic i18n keys
// (`help.categories.<id>.*`, `help.lessons.<id>.*`), which the orphan-key
// scanner can't follow — so these tests are the guard that every id in the
// table actually resolves to a real message. A typo'd id would otherwise
// render a raw key in the UI and pass every other check.
const help = enMessages.help as {
  categories: Record<string, { title: string; description: string }>;
  lessons: Record<string, { title: string; summary: string; body: string }>;
};

describe('help curriculum', () => {
  it('every category id maps to a localized title and description', () => {
    for (const category of HELP_CATEGORIES) {
      expect(help.categories[category.id]?.title).toBeTruthy();
      expect(help.categories[category.id]?.description).toBeTruthy();
    }
  });

  it('every lesson id maps to a localized title, summary, and body', () => {
    for (const category of HELP_CATEGORIES) {
      for (const lesson of category.lessons) {
        const copy = help.lessons[lesson.id];
        expect(copy?.title).toBeTruthy();
        expect(copy?.summary).toBeTruthy();
        expect(copy?.body).toBeTruthy();
      }
    }
  });

  it('exposes a flat lesson-id list with no duplicates', () => {
    const unique = new Set(ALL_LESSON_IDS);
    expect(unique.size).toBe(ALL_LESSON_IDS.length);
    expect(ALL_LESSON_IDS.length).toBeGreaterThan(0);
  });

  it('covers the three pillars from issue #1922', () => {
    const ids = HELP_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(['fundamentals', 'platform', 'responsibleAi']);
  });

  describe('findLesson', () => {
    it('resolves a known lesson to its category', () => {
      const result = findLesson('whatAreLlms');
      expect(result?.category.id).toBe('fundamentals');
      expect(result?.lesson.id).toBe('whatAreLlms');
    });

    it('returns null for an unknown id', () => {
      expect(findLesson('does-not-exist')).toBeNull();
    });
  });
});
