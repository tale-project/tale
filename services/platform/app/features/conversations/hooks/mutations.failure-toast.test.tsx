import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import { act, cleanup, render, screen } from '@/tests/utils/render';

import { useRetrySendMessage } from './mutations';

// Retry ran on two failed messages, one after the other, and the first was
// refused: nothing said so. Its only report was the panel's `mutate(args,
// { onError })`, which react-query drops once a second `mutate` starts on the
// same hook, or once the panel unmounts before the write settles. The write
// raises its own toast now, and that fires for every call. The write runs for
// real — the hook, `useBackendMutation`, the adapter row — up to the fetch.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn() };
});

const RETRY = 'conversations/mutations:retrySendMessage';

/** The two failed messages' Retry buttons, as the panel wires them. */
function FailedMessages() {
  const { mutate: retrySendMessage } = useRetrySendMessage();
  return (
    <>
      {['a', 'b'].map((messageId) => (
        <button
          key={messageId}
          type="button"
          onClick={() => retrySendMessage({ messageId })}
        >
          Retry {messageId}
        </button>
      ))}
    </>
  );
}

/** Each retry's answer, settled by the test. */
function pendingRetries() {
  const answers = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  vi.spyOn(WRITE_ADAPTERS[RETRY], 'run').mockImplementation(
    (args) =>
      new Promise((resolve, reject) => {
        answers.set(String(args.messageId), { resolve, reject });
      }),
  );
  return answers;
}

const refusal = () =>
  new AppError({
    code: 'MESSAGE_NOT_RETRYABLE',
    message: 'The message was already delivered.',
  });

function renderMessages() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <FailedMessages />
    </QueryClientProvider>,
  );
}

function failureToasts() {
  return vi
    .mocked(toast)
    .mock.calls.map(([shown]) => shown)
    .filter((shown) => shown.variant === 'destructive');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
});

describe('useRetrySendMessage', () => {
  it('reports a refused retry once while a second retry is still pending', async () => {
    const answers = pendingRetries();
    const { user } = renderMessages();

    await user.click(screen.getByRole('button', { name: 'Retry a' }));
    await user.click(screen.getByRole('button', { name: 'Retry b' }));
    await act(async () => {
      answers.get('a')?.reject(refusal());
      answers.get('b')?.resolve(null);
    });

    expect(failureToasts()).toEqual([
      {
        title: i18n.t('panel.retrySendFailed', { ns: 'conversations' }),
        description: 'The message was already delivered.',
        variant: 'destructive',
      },
    ]);
  });

  it('reports a retry refused after its panel closed', async () => {
    const answers = pendingRetries();
    const { user, unmount } = renderMessages();

    await user.click(screen.getByRole('button', { name: 'Retry a' }));
    unmount();
    await act(async () => {
      answers.get('a')?.reject(refusal());
    });

    expect(failureToasts()).toHaveLength(1);
  });
});
