import { describe, expect, it } from 'vitest';

import { mirrorMessage } from './mirror_message';

const MOVED = {
  title: 'Compare the offers',
  from: 'in_progress',
  to: 'in_review',
};

describe('mirrorMessage', () => {
  it.each([
    ['en', '"Compare the offers" moved from In progress to In review.'],
    ['de', '"Compare the offers" wechselte von In Bearbeitung zu In Prüfung.'],
  ])(
    'names a status change’s columns as the board does (%s)',
    (locale, text) => {
      expect(
        mirrorMessage('inbox', 'taskStatusChangedBody', MOVED, locale),
      ).toBe(text);
    },
  );

  it('falls back to the German column names for Swiss German', () => {
    expect(
      mirrorMessage('inbox', 'taskStatusChangedBody', MOVED, 'de-CH'),
    ).toContain('von In Bearbeitung zu In Prüfung');
  });

  it('prints any other value as it was written', () => {
    expect(
      mirrorMessage(
        'inbox',
        'agentRunFailedBody',
        { title: 'in_review', projectId: 'proj-1' },
        'en',
      ),
    ).toBe(
      'The agent couldn\'t finish "in_review". Open the task to see why and start it again.',
    );
  });
});
