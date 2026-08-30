// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { AppError } from '@/lib/shared/errors/app-error';
import { render, waitFor } from '@/tests/utils/render';

import { AddKnowledgeEntryDialog } from './knowledge-entry-add-dialog';

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

// FormDialog reads the org id from the router; the test harness has no router.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// Controllable mutate so a test can drive its onError callback. The dialog uses
// the callback form `mutate(args, { onSuccess, onError })`.
const createEntryMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useCreateKnowledgeEntry: () => ({
    mutate: createEntryMock,
    isPending: false,
  }),
}));

async function fillAndSubmit(user: ReturnType<typeof render>['user']) {
  const topic = document.querySelector(
    'input[name="topic"]',
  ) as HTMLInputElement;
  const content = document.querySelector(
    'textarea[name="content"]',
  ) as HTMLTextAreaElement;
  await user.type(topic, 'Refunds');
  await user.type(content, 'How refunds work.');

  const submit = document.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The dialog logs every failure via console.error; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AddKnowledgeEntryDialog', () => {
  // Regression for #2056: in prod Convex redacts raw Error messages to "Server
  // Error", so the old `error.message.includes('already exists')` check was
  // dead and the duplicate toast never appeared. The backend now throws
  // AppError({ code: 'KNOWLEDGE_ENTRY_DUPLICATE' }) and the dialog reads the
  // code, which survives the redaction.
  it('surfaces the duplicate toast when the server throws the duplicate code', async () => {
    createEntryMock.mockImplementation(
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
      <AddKnowledgeEntryDialog
        isOpen={true}
        onClose={vi.fn()}
        organizationId="org-1"
      />,
    );
    await fillAndSubmit(user);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'An entry for this topic already exists',
          variant: 'destructive',
        }),
      ),
    );
  });

  it('falls back to the generic error toast for a non-duplicate failure', async () => {
    createEntryMock.mockImplementation(
      (_args: unknown, opts: { onError: (e: unknown) => void }) => {
        opts.onError(new AppError({ code: 'SOMETHING_ELSE' }));
      },
    );

    const { user } = render(
      <AddKnowledgeEntryDialog
        isOpen={true}
        onClose={vi.fn()}
        organizationId="org-1"
      />,
    );
    await fillAndSubmit(user);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Failed to add knowledge entry',
          variant: 'destructive',
        }),
      ),
    );
  });
});
