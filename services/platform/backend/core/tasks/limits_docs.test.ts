import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from './helpers';

/**
 * The task page of the user docs states the title and description caps
 * (`docs/{en,de,fr}/platform/projects/tasks.md`), each in its locale's
 * number format. The pages copy the numbers by hand, so a cap that moves
 * without them — or a page that drifts from the domain — fails here rather
 * than teaching a limit the server no longer holds (TALE-75 review). The
 * pages are outside this workspace: `services/platform/turbo.json` hashes
 * them for this suite.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

/** Where each locale's page words the two caps: before the number, after it. */
const PHRASES = {
  en: {
    title: ['A title can have up to ', ' characters'],
    description: ['a description up to ', ';'],
  },
  de: {
    title: ['Ein Titel darf bis zu ', ' Zeichen'],
    description: ['eine Beschreibung bis zu ', ';'],
  },
  fr: {
    title: ['Un titre compte jusqu’à ', ' caractères'],
    // French sets a no-break space before the semicolon.
    description: ['une description jusqu’à ', '\u00a0;'],
  },
} as const;

describe('the task docs state the caps the domain holds', () => {
  for (const [locale, phrases] of Object.entries(PHRASES)) {
    it(`docs/${locale}/platform/projects/tasks.md`, () => {
      const page = readFileSync(
        path.join(REPO_ROOT, 'docs', locale, 'platform/projects/tasks.md'),
        'utf8',
      );
      const numbers = new Intl.NumberFormat(locale);
      const format = (value: number) => numbers.format(value);
      const [titleBefore, titleAfter] = phrases.title;
      const [descriptionBefore, descriptionAfter] = phrases.description;
      expect(page).toContain(
        `${titleBefore}${format(TASK_TITLE_MAX)}${titleAfter}`,
      );
      expect(page).toContain(
        `${descriptionBefore}${format(TASK_DESCRIPTION_MAX)}${descriptionAfter}`,
      );
    });
  }
});
