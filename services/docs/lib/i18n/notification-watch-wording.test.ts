import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('team access notifications use the task Watch terminology (#4077)', () => {
  it.each([
    ['en', 'tasks they watch', 'tasks they follow'],
    ['de', 'Aufgaben, die sie verfolgt', 'Aufgaben, denen sie folgt'],
    ['fr', 'tâches qu’elle suit', ''],
  ])(
    '%s keeps the subscription wording aligned with the UI',
    (locale, wording, obsolete) => {
      const content = readFileSync(
        new URL(
          `../../../../docs/${locale}/platform/admin/teams.md`,
          import.meta.url,
        ),
        'utf8',
      );

      expect(content).toContain(wording);
      if (obsolete !== '') expect(content).not.toContain(obsolete);
    },
  );
});
