import { describe, expect, it } from 'vitest';

import { HERO_THREAD_CLASS } from './hero-orchestration';

describe('HERO_THREAD_CLASS', () => {
  it('grows the thread downward so new beats do not shift prior bubbles', () => {
    expect(HERO_THREAD_CLASS).toContain('justify-start');
    expect(HERO_THREAD_CLASS).not.toContain('justify-end');
  });
});
