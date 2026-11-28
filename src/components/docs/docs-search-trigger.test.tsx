import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DocsSearchTrigger } from './docs-search-trigger';

describe('DocsSearchTrigger', () => {
  // WCAG 2.5.3 (Label in Name): the name a screen reader announces, and the
  // one a voice-control user speaks, is the text the field shows.
  it('is named by its visible text and opens the palette', async () => {
    const onClick = vi.fn();
    const { user } = render(<DocsSearchTrigger onClick={onClick} />);
    const trigger = screen.getByRole('button', {
      name: 'Search documentation',
    });
    await user.click(trigger);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('announces the palette shortcut as a shortcut, not as part of its name', () => {
    render(<DocsSearchTrigger onClick={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Search documentation' }),
    ).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  });
});
