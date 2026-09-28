import '@testing-library/jest-dom/vitest';
import { ListenerManager } from '@milkdown/kit/plugin/listener';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

import { MessageEditor } from './message-editor';
import { messageDraftKeys } from './message-editor/types';

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useAuth: () => ({ user: { userId: 'user1' } }),
}));
vi.mock('../hooks/actions', () => ({
  useImproveMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./message-editor/improve-mode', () => ({ ImproveMode: () => null }));
vi.mock('./message-improvement-dialog', () => ({
  MessageImprovementDialog: () => null,
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

/**
 * Milkdown hands an edit to the reply box's draft on a debounce after the
 * last keystroke. Sending — which remounts the editor — or leaving the
 * conversation inside that window destroyed the editor while the hand-off was
 * still scheduled; it then ran against the destroyed editor and threw
 * `Context "editorView" not found` (#3567). The clock is fake from the first
 * keystroke, so the hand-off stays pending for exactly as long as the test
 * needs and runs only when the test runs the timers: no race, no sleep.
 */
const draft = messageDraftKeys('user1', 'c1');
const EDITOR = { name: 'Write your message…' };

interface BuiltEditor {
  mounted: Promise<void>;
  destroyed: Promise<void>;
}

// oxlint-disable-next-line typescript/unbound-method -- forwarded with call(this, callback), keeping the editor's own listener manager.
const subscribeMarkdownUpdated = ListenerManager.prototype.markdownUpdated;
let built: BuiltEditor[] = [];
let onBuilt: ((editor: BuiltEditor) => void) | undefined;

/** The next real editor the reply box builds, e.g. after a send. */
function nextEditor() {
  return new Promise<BuiltEditor>((resolve) => {
    onBuilt = resolve;
  });
}

beforeEach(() => {
  built = [];
  onBuilt = undefined;
  window.localStorage.clear();
  // The reply box subscribes to every editor it builds. Beside that
  // subscription, listen to Milkdown's own mounted and destroy events, so the
  // test knows when the editor it typed into is gone and its successor is up.
  vi.spyOn(ListenerManager.prototype, 'markdownUpdated').mockImplementation(
    function (this: ListenerManager, callback) {
      const mounted = Promise.withResolvers<void>();
      const destroyed = Promise.withResolvers<void>();
      this.mounted(() => mounted.resolve()).destroy(() => destroyed.resolve());
      const editor = { mounted: mounted.promise, destroyed: destroyed.promise };
      built.push(editor);
      onBuilt?.(editor);
      onBuilt = undefined;
      return subscribeMarkdownUpdated.call(this, callback);
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Type into the live editor with its draft hand-off still pending. */
async function typeUnpublished(textbox: HTMLElement, text: string) {
  const typedInto = built.at(-1);
  if (!typedInto) throw new Error('no editor was built');
  await typedInto.mounted;
  // Only the timers: React's scheduler and the browser's own tasks keep
  // running, while the debounce waits on this clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await userEvent.type(textbox, text);
  expect(textbox).toHaveTextContent(text);
  expect(window.localStorage.getItem(draft.body)).toBeNull();
  return typedInto;
}

describe('Inbox editor with an unpublished edit', () => {
  // Control: the same fake clock does drive Milkdown's hand-off, so the cases
  // below cannot pass merely because nothing was ever scheduled.
  it('hands the edit to the draft once its debounce runs', async () => {
    render(
      <MessageEditor
        organizationId="org1"
        messageId="c1"
        placeholder={EDITOR.name}
      />,
    );
    const textbox = await screen.findByRole('textbox', EDITOR);
    await typeUnpublished(textbox, 'Urgent');

    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    await waitFor(() =>
      expect(window.localStorage.getItem(draft.body)).toContain('Urgent'),
    );
  });

  it('sends, remounts, and runs nothing against the sent editor', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const sent = Promise.withResolvers<void>();
    const { user, container } = render(
      <MessageEditor
        organizationId="org1"
        messageId="c1"
        placeholder={EDITOR.name}
        onSave={onSave}
        onPendingMessageConsumed={() => sent.resolve()}
      />,
    );
    const textbox = await screen.findByRole('textbox', EDITOR);
    // A file lets Send go while the typed text is still unpublished — the
    // fast send the issue reproduced.
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('the reply box has no file input');
    await user.upload(
      input,
      new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
    );
    const send = screen.getByRole('button', { name: 'Send message' });
    await waitFor(() => expect(send).toBeEnabled());

    const typedInto = await typeUnpublished(textbox, 'Urgent');
    const successor = nextEditor();
    await userEvent.click(send);
    await sent.promise;
    await typedInto.destroyed;
    const replacement = await successor;
    await replacement.mounted;

    // Run whatever the sent editor left scheduled. Its hand-off was still
    // there and threw against the destroyed editor; none of it may run now.
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ name: 'invoice.pdf' }),
      }),
    ]);
    // Published after the send, the sent text would come back as a draft.
    expect(window.localStorage.getItem(draft.body)).toBeNull();
    expect((await screen.findByRole('textbox', EDITOR)).textContent).toBe('');
  });

  it('leaves the conversation and runs nothing against the left editor', async () => {
    const { unmount } = render(
      <MessageEditor
        organizationId="org1"
        messageId="c1"
        placeholder={EDITOR.name}
      />,
    );
    const textbox = await screen.findByRole('textbox', EDITOR);
    const typedInto = await typeUnpublished(textbox, 'Urgent');

    unmount();
    await typedInto.destroyed;

    // As after a send: nothing the left editor scheduled may run against it.
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    // No late write from an editor that is gone.
    expect(window.localStorage.getItem(draft.body)).toBeNull();
  });
});
