// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../../hooks/mutations', () => ({
  useCreatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSavePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/queries', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/queries')>(
    '../../hooks/queries',
  );
  return {
    ...actual,
    usePrompts: () => ({ prompts: [], isLoading: false }),
  };
});

import { SavePromptDialog } from '../save-prompt-dialog';

describe('SavePromptDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello, this is a test prompt."
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders with initial content when open', () => {
    render(
      <SavePromptDialog
        open={true}
        onOpenChange={vi.fn()}
        initialContent="Hello, this is a test prompt."
      />,
    );
    expect(screen.getByText('prompts.saveAs.title')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <SavePromptDialog
        open={false}
        onOpenChange={vi.fn()}
        initialContent="Some content"
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
