import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SavePromptMenu } from './save-prompt-menu';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        promptLibrary: 'Prompt library',
        savePromptDraft: 'Save prompt draft',
        savePromptMenu: 'Save prompt',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('SavePromptMenu', () => {
  it('shows a book icon when the composer is empty (opens library)', () => {
    // Empty composer → one-click Prompt library. The trigger must read as the
    // destination (BookOpen), not a save/bookmark affordance.
    render(
      <SavePromptMenu
        onSavePromptDraft={vi.fn()}
        onOpenPromptLibrary={vi.fn()}
        canSavePromptDraft={false}
      />,
    );

    const button = screen.getByRole('button', { name: 'Prompt library' });
    expect(button.querySelector('.lucide-book-open')).toBeTruthy();
    expect(button.querySelector('.lucide-bookmark')).toBeNull();
  });

  it('shows a bookmark icon when the composer has content (save menu)', () => {
    render(
      <SavePromptMenu
        onSavePromptDraft={vi.fn()}
        onOpenPromptLibrary={vi.fn()}
        canSavePromptDraft={true}
      />,
    );

    const button = screen.getByRole('button', { name: 'Save prompt' });
    expect(button.querySelector('.lucide-bookmark')).toBeTruthy();
    expect(button.querySelector('.lucide-book-open')).toBeNull();
  });
});
