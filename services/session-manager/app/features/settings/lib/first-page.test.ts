import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { stubViewport } from '@/tests/utils/viewport';

import { openFirstPageOnDesktop } from './first-page';

describe('openFirstPageOnDesktop', () => {
  it('sends a computer on to the first page, replacing the index in the history', () => {
    stubViewport('desktop');
    let thrown: unknown;
    try {
      openFirstPageOnDesktop();
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: { to: '/settings/general', replace: true },
    });
  });

  it('lets a phone stay, for it has no panel to choose a page in', () => {
    stubViewport('phone');
    expect(() => openFirstPageOnDesktop()).not.toThrow();
  });
});
