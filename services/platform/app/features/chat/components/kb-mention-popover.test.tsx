import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { KbMention } from '../hooks/use-kb-mentions';
import { KbMentionPopover } from './kb-mention-popover';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'kbMention.title': 'Knowledge base',
        'kbMention.loading': 'Searching documents…',
        'kbMention.empty': 'No matching indexed documents',
        'kbMention.emptyNoQuery': 'No indexed documents yet',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('./anchored-mention-popover-shell', () => ({
  AnchoredMentionPopoverShell: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="mention-popover-shell">{children}</div>,
}));

function mention(n: number): KbMention {
  return {
    documentId: `doc_${n}` as Id<'documents'>,
    fileId: `file_${n}` as Id<'_storage'>,
    title: `Document ${n}`,
    fileType: 'application/pdf',
    fileSize: 100,
    folderPath: n === 1 ? 'reports/q3' : undefined,
  };
}

function resultOf(n: number) {
  const data = mention(n);
  return {
    id: data.documentId,
    title: data.title,
    subtitle: data.folderPath,
    data,
  };
}

const baseProps = {
  anchorRef: createRef<HTMLDivElement>(),
  open: true,
  query: 'doc',
  highlightedIndex: 0,
  onHighlight: vi.fn(),
  onSelect: vi.fn(),
  listboxId: 'kb-listbox',
  optionId: (index: number) => `kb-listbox-option-${index}`,
};

describe('KbMentionPopover', () => {
  it('renders results as listbox options and selects on mousedown', () => {
    const onSelect = vi.fn();
    render(
      <KbMentionPopover
        {...baseProps}
        onSelect={onSelect}
        results={[resultOf(1), resultOf(2)]}
        status="ready"
      />,
    );

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');

    options[1].dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc_2' }),
    );
  });

  it('shows the empty state when there are no results', () => {
    render(<KbMentionPopover {...baseProps} results={[]} status="ready" />);
    expect(
      screen.getByText('No matching indexed documents'),
    ).toBeInTheDocument();
  });

  it('shows the loading state while searching', () => {
    render(<KbMentionPopover {...baseProps} results={[]} status="loading" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with results', async () => {
      const { container } = render(
        <KbMentionPopover
          {...baseProps}
          results={[resultOf(1), resultOf(2)]}
          status="ready"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in the empty state', async () => {
      const { container } = render(
        <KbMentionPopover {...baseProps} results={[]} status="ready" />,
      );
      await checkAccessibility(container);
    });
  });
});
