import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { ViewKnowledgeEntryDialog } from './knowledge-entry-view-dialog';

const canWrite = { current: true };
const mockUpdate = vi.fn();

const versions = {
  current: [] as Array<{
    _id: string;
    topic: string;
    content: string;
    createdAt: number;
    supersededAt?: number;
  }>,
};

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => canWrite.current,
    cannot: () => !canWrite.current,
  }),
}));

vi.mock('@/app/hooks/use-backend-action', () => {
  const mutate = vi.fn();
  return {
    useBackendAction: () => ({
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateKnowledgeEntry: () => ({ mutate: mockUpdate, isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  useKnowledgeEntryVersions: () => ({
    data: { versions: versions.current },
  }),
}));

const ENTRY: KnowledgeEntryItem = {
  _id: 'entry-1' as never,
  _creationTime: Date.parse('2026-09-14T11:11:00'),
  organizationId: 'org-1',
  topic: 'Shipping times',
  topicKey: 'shipping times',
  content:
    'Standard shipping is 3-5 business days. Express arrives the next weekday if ordered before 2 pm.',
  status: 'active',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: Date.parse('2026-09-14T11:11:00'),
  ragStatus: 'not_indexed',
};

describe('ViewKnowledgeEntryDialog', () => {
  beforeEach(() => {
    canWrite.current = true;
    versions.current = [];
    mockUpdate.mockReset();
  });

  it('titles the dialog with the topic, not a filler chrome title', () => {
    render(<ViewKnowledgeEntryDialog isOpen onClose={vi.fn()} entry={ENTRY} />);

    const dialog = screen.getByRole('dialog', { name: 'Shipping times' });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Knowledge entry details' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText('Manual')).toBeInTheDocument();
    expect(within(dialog).getByText('Not indexed')).toBeInTheDocument();
    expect(within(dialog).getByText(ENTRY.content)).toBeInTheDocument();
    expect(dialog).toHaveClass('md:max-w-[24rem]');
  });

  it('does not repeat table fields or a Content label', () => {
    render(<ViewKnowledgeEntryDialog isOpen onClose={vi.fn()} entry={ENTRY} />);

    expect(screen.queryByText('Topic')).not.toBeInTheDocument();
    expect(screen.queryByText('Indexing status')).not.toBeInTheDocument();
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.getAllByText('Shipping times')).toHaveLength(1);
  });

  it('offers Edit for a writer without opening the form until they ask', () => {
    render(<ViewKnowledgeEntryDialog isOpen onClose={vi.fn()} entry={ENTRY} />);

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Edit knowledge entry' }),
    ).not.toBeInTheDocument();
  });

  it('hides Edit for a reader', () => {
    canWrite.current = false;
    render(<ViewKnowledgeEntryDialog isOpen onClose={vi.fn()} entry={ENTRY} />);

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  it('swaps the same dialog into the edit form without a second overlay', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ViewKnowledgeEntryDialog isOpen onClose={onClose} entry={ENTRY} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onClose).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName('Edit knowledge entry');
    expect(dialogs[0]).toHaveClass('md:max-w-[24rem]');
    expect(
      screen.queryByRole('dialog', { name: 'Shipping times' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Topic')).toHaveValue('Shipping times');
    expect(screen.getByLabelText('Content')).toHaveValue(ENTRY.content);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('returns to the view on Cancel without closing the overlay', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ViewKnowledgeEntryDialog isOpen onClose={onClose} entry={ENTRY} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Shipping times' })).toHaveClass(
      'md:max-w-[24rem]',
    );
    expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
    expect(screen.getByText(ENTRY.content)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('saves from the footer without remounting the overlay', async () => {
    mockUpdate.mockImplementation(
      (_args: unknown, opts: { onSuccess?: () => void }) => {
        opts.onSuccess?.();
      },
    );
    const onClose = vi.fn();
    const { user } = render(
      <ViewKnowledgeEntryDialog isOpen onClose={onClose} entry={ENTRY} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const topic = screen.getByLabelText('Topic');
    await user.clear(topic);
    await user.type(topic, 'Shipping windows');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdate.mock.calls[0]?.[0]).toEqual({
      entryId: ENTRY._id,
      topic: 'Shipping windows',
      content: ENTRY.content,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Shipping times' })).toHaveClass(
      'md:max-w-[24rem]',
    );
    expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('lists previous versions when the chain has any', () => {
    versions.current = [
      {
        _id: 'v-1',
        topic: 'Shipping times',
        content: 'Standard shipping is 5 business days.',
        createdAt: Date.parse('2026-09-01T09:00:00'),
        supersededAt: Date.parse('2026-09-14T11:11:00'),
      },
    ];

    render(<ViewKnowledgeEntryDialog isOpen onClose={vi.fn()} entry={ENTRY} />);

    expect(screen.getByText('Version history')).toBeInTheDocument();
    expect(screen.getByText('1 previous version')).toBeInTheDocument();
    expect(screen.getByText('Superseded')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <ViewKnowledgeEntryDialog
        isOpen={false}
        onClose={vi.fn()}
        entry={ENTRY}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ViewKnowledgeEntryDialog isOpen onClose={vi.fn()} entry={ENTRY} />,
      );
      await checkAccessibility(container);
    });
  });
});
