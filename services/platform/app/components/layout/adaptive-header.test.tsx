import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
  AdaptiveHeaderSlot,
  AdaptiveHeaderTitle,
} from './adaptive-header';

describe('AdaptiveHeader', () => {
  describe('accessibility', () => {
    it('AdaptiveHeaderTitle passes axe audit', async () => {
      const { container } = render(
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderRoot>
            <AdaptiveHeaderTitle>Page Title</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        </AdaptiveHeaderProvider>,
      );
      await checkAccessibility(container);
    });

    it('AdaptiveHeaderSlot passes axe audit', async () => {
      const { container } = render(
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderSlot />
        </AdaptiveHeaderProvider>,
      );
      await checkAccessibility(container);
    });

    // The title is rendered twice — once by the desktop root, once mirrored
    // into the mobile slot — so the inactive copy must be hidden from the
    // accessibility tree (`aria-hidden`) to avoid a duplicate `h1`. `getByRole`
    // ignores `aria-hidden` subtrees, so exactly one heading must remain.
    it('exposes only one h1 even though the title is mirrored into the slot', () => {
      render(
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderRoot>
            <AdaptiveHeaderTitle>Page Title</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <AdaptiveHeaderSlot />
        </AdaptiveHeaderProvider>,
      );
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Page Title',
      );
    });
  });

  it('keeps in-header sibling actions on the title row', () => {
    // Settings (and a few other shells) pass Discard/Save as children of
    // the root, not through the portal slot. Wrapping `{children}` in one
    // block stacks those buttons under the name; the fixed `h-13` strip
    // then clips them.
    render(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot>
          <AdaptiveHeaderTitle>Settings</AdaptiveHeaderTitle>
          <div className="ml-auto flex items-center gap-2">
            <button type="button">Discard</button>
            <button type="button">Save</button>
          </div>
        </AdaptiveHeaderRoot>
      </AdaptiveHeaderProvider>,
    );
    const title = screen.getByRole('heading', { name: 'Settings' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(title.parentElement?.className).toMatch(/\bh-13\b/);
    expect(save.parentElement?.parentElement).toBe(title.parentElement);
  });
});
