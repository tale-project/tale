// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { render, waitFor } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryEditDialog } from './knowledge-entry-edit-dialog';

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

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

describe('KnowledgeEntryEditDialog', () => {
  // Regression for #2056: a topic rename that collides with another live entry
  // must surface the duplicate toast. The backend throws
  // AppError({ code: 'KNOWLEDGE_ENTRY_DUPLICATE' }); the dialog reads the
  // code rather than the prod-redacted error message.
  it('surfaces the duplicate toast when the server throws the duplicate code', async () => {
    updateEntryMock.mockImplementation(
      (_args: unknown, opts: { onError: (e: unknown) => void }) => {
        opts.onError(
          new AppError({
            code: 'KNOWLEDGE_ENTRY_DUPLICATE',
            topic: 'Refunds',
          }),
        );
      },
    );

    const { user } = render(
      <KnowledgeEntryEditDialog
        isOpen={true}
        onClose={vi.fn()}
        entry={ENTRY}
      />,
    );

    // Save stays disabled until something changed.
    const submit = document.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit).toBeDisabled();
    const topic = document.querySelector(
      'input[name="topic"]',
    ) as HTMLInputElement;
    await user.clear(topic);
    await user.type(topic, 'Returns');
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
