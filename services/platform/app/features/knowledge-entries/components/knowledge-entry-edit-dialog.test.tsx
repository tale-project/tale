// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { render, waitFor } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { EditKnowledgeEntryDialog } from './knowledge-entry-edit-dialog';

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const updateEntryMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useUpdateKnowledgeEntry: () => ({
    mutate: updateEntryMock,
    isPending: false,
  }),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the dialog only reads _id, topic, content
const ENTRY = {
  _id: 'entry-1',
  topic: 'Refunds',
  content: 'How refunds work.',
} as KnowledgeEntryItem;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('EditKnowledgeEntryDialog', () => {
  // Regression for #2056: a topic rename that collides with another live entry
  // must surface the duplicate toast. The backend throws
  // ConvexError({ code: 'KNOWLEDGE_ENTRY_DUPLICATE' }); the dialog reads the
  // code rather than the prod-redacted error message.
  it('surfaces the duplicate toast when the server throws the duplicate code', async () => {
    updateEntryMock.mockImplementation(
      (_args: unknown, opts: { onError: (e: unknown) => void }) => {
        opts.onError(
          new ConvexError({
            code: 'KNOWLEDGE_ENTRY_DUPLICATE',
            topic: 'Refunds',
          }),
        );
      },
    );

    const { user } = render(
      <EditKnowledgeEntryDialog
        isOpen={true}
        onClose={vi.fn()}
        entry={ENTRY}
      />,
    );

    const submit = document.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'An entry for this topic already exists',
          variant: 'destructive',
        }),
      ),
    );
  });
});
