import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { KbMention } from '../hooks/use-kb-mentions';
import {
  flattenMentionSections,
  MentionPopover,
  type MentionRow,
  type MentionSection,
} from './mention-popover';

vi.mock('./anchored-mention-popover-shell', () => ({
  AnchoredMentionPopoverShell: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="mention-popover-shell">{children}</div>,
}));

function kbMention(n: number): KbMention {
  return {
    documentId: `doc_${n}` as Id<'documents'>,
    fileId: `file_${n}` as Id<'_storage'>,
    title: `Document ${n}`,
    fileType: 'application/pdf',
    fileSize: 100,
    folderPath: n === 1 ? 'reports/q3' : undefined,
  };
}

function documentRow(n: number): MentionRow {
  const data = kbMention(n);
  return {
    kind: 'document',
    id: data.documentId,
    data,
    subtitle: data.folderPath,
  };
}

function actorRow(
  type: 'user' | 'agent',
  name: string,
  handle: string,
): MentionRow {
  return {
    kind: 'actor',
    id: `${type}:${handle}`,
    data: { type, id: handle, name, handle },
  };
}

const baseProps = {
  anchorRef: createRef<HTMLDivElement>(),
  open: true,
  query: '',
  highlightedIndex: 0,
  onHighlight: vi.fn(),
  onSelect: vi.fn(),
  listboxId: 'mention-listbox',
  optionId: (index: number) => `mention-listbox-option-${index}`,
};

const filledSections: MentionSection[] = [
  {
    id: 'agents',
    label: 'Agents',
    rows: [actorRow('agent', 'Helper Bot', 'helper-bot')],
  },
  {
    id: 'teammates',
    label: 'Teammates',
    rows: [actorRow('user', 'Alice Smith', 'alice')],
  },
  {
    id: 'documents',
    label: 'Documents',
    rows: [documentRow(1), documentRow(2)],
  },
];

describe('MentionPopover', () => {
  it('renders every section as one flat listbox with cross-section option ids', () => {
    render(<MentionPopover {...baseProps} sections={filledSections} />);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    // Options are numbered ACROSS sections so aria-activedescendant maps 1:1
    // to the composer's flat highlight index.
    expect(options.map((o) => o.id)).toEqual([
      'mention-listbox-option-0',
      'mention-listbox-option-1',
      'mention-listbox-option-2',
      'mention-listbox-option-3',
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Teammates')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('selects a row on mousedown (keeps the textarea focused)', () => {
    const onSelect = vi.fn();
    render(
      <MentionPopover
        {...baseProps}
        onSelect={onSelect}
        sections={filledSections}
      />,
    );

    const options = screen.getAllByRole('option');
    options[3].dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'document',
        data: expect.objectContaining({ documentId: 'doc_2' }),
      }),
    );
  });

  it('renders an empty section as its message plus a selectable action row', () => {
    const run = vi.fn();
    const onSelect = vi.fn();
    render(
      <MentionPopover
        {...baseProps}
        onSelect={onSelect}
        sections={[
          {
            id: 'documents',
            label: 'Documents',
            emptyMessage: 'No indexed documents yet',
            rows: [
              {
                kind: 'action',
                id: 'documents-empty-action',
                label: 'Upload documents',
                run,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('No indexed documents yet')).toBeInTheDocument();
    const action = screen.getByRole('option', { name: 'Upload documents' });
    action.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'action' }),
    );
  });

  it('shows a single "No matches" state when every section is empty', () => {
    render(
      <MentionPopover
        {...baseProps}
        query="zzzz"
        sections={[{ id: 'agents', label: 'Agents', rows: [] }]}
      />,
    );
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the loading state while the documents search resolves', () => {
    render(
      <MentionPopover
        {...baseProps}
        sections={[
          { id: 'documents', label: 'Documents', rows: [], loading: true },
        ]}
      />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('flattens sections in order for keyboard navigation', () => {
    expect(flattenMentionSections(filledSections).map((row) => row.id)).toEqual(
      ['agent:helper-bot', 'user:alice', 'doc_1', 'doc_2'],
    );
  });

  describe('accessibility', () => {
    it('passes axe audit with mixed sections', async () => {
      const { container } = render(
        <MentionPopover {...baseProps} sections={filledSections} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with an empty-state action section', async () => {
      const { container } = render(
        <MentionPopover
          {...baseProps}
          sections={[
            {
              id: 'teammates',
              label: 'Teammates',
              emptyMessage: 'No teammates to mention yet',
              rows: [
                {
                  kind: 'action',
                  id: 'teammates-empty-action',
                  label: 'Invite teammates',
                  run: vi.fn(),
                },
              ],
            },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
