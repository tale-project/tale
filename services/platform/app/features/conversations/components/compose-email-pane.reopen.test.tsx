// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { SendButton } from '@tale/ui/send-button';
import { act, cleanup } from '@testing-library/react';
import { useTransition } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import { ComposeEmailPane } from './compose-email-pane';
import { messageDraftKeys, type AttachedFile } from './message-editor/types';

// Compose closed and reopened while a send is in flight, with the drafts kept
// where production keeps them: the real `usePersistedState` over localStorage.

const composeMock = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => ({
    conversationId: 'c-new',
    messageId: 'm-new',
  })),
);
const editorSaveMock = vi.hoisted(() =>
  vi.fn(async (_message: string, _attachments?: AttachedFile[]) => {}),
);
// What the editor reports when its send rejects (it keeps the body and toasts).
const editorSendFailedMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useEmailConnectors: () => ({
    emailConnectors: [
      {
        credentialId: 'cred-general',
        slug: 'imap-smtp',
        title: 'General Support',
        type: 'imap_smtp',
        fromAddress: 'hello@support.test',
      },
      {
        credentialId: 'cred-recruitment',
        slug: 'imap-smtp',
        title: 'Recruitment Support',
        type: 'imap_smtp',
        fromAddress: 'jobs@support.test',
      },
    ],
    isLoading: false,
    error: undefined,
    retry: vi.fn(),
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useComposeEmailConversation: () => ({
    mutateAsync: composeMock,
    isPending: false,
  }),
  useGenerateUploadUrl: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [] }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { role: 'admin' } }),
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

vi.mock('./contact-recipient-picker', () => ({
  ContactRecipientPicker: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="recipient-picker" data-disabled={disabled || undefined} />
  ),
}));

// The editor's draft lifecycle as the real one runs it: the body persists
// under its draft key, onSave runs inside the send transition, and only a
// resolved send clears the body. An earlier mount's send still in flight
// holds the body and Send like its own.
function DraftEditor({
  onSave,
  disabled,
  sending = false,
  messageId,
}: {
  onSave: (message: string, attachments?: AttachedFile[]) => Promise<void>;
  disabled?: boolean;
  sending?: boolean;
  messageId?: string;
}) {
  const [body, setBody, clearBody] = usePersistedState(
    messageDraftKeys('user-1', messageId).body,
    '',
  );
  const [isSendPending, startSendingTransition] = useTransition();
  const isSending = isSendPending || sending;
  editorSaveMock.mockImplementation(onSave);
  return (
    <>
      <textarea
        aria-label="Body"
        value={body}
        disabled={isSending}
        onChange={(event) => setBody(event.target.value)}
      />
      <SendButton
        label="Send body"
        disabled={disabled}
        sending={isSending}
        onClick={() =>
          startSendingTransition(async () => {
            try {
              await onSave(`<p>${body}</p>`);
              clearBody();
            } catch (error) {
              editorSendFailedMock(error);
            }
          })
        }
      />
    </>
  );
}

vi.mock('@tale/ui/lazy-component', () => ({
  lazyComponent: () => DraftEditor,
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

const adminAbility = defineAbilityFor('admin');
const DRAFT = 'compose-user-1-org-1';
const BODY = messageDraftKeys('user-1', 'compose-org-1').body;
const IMPROVE = messageDraftKeys('user-1', 'compose-org-1').improveInstruction;
const SENDING = 'Sending… The draft is locked until the send finishes.';

function stored(key: string): unknown {
  const item = window.localStorage.getItem(key);
  return item === null ? undefined : JSON.parse(item);
}

function renderCompose(onSent = vi.fn()) {
  return render(
    <AbilityContext.Provider value={adminAbility}>
      <ComposeEmailPane
        organizationId="org-1"
        onClose={vi.fn()}
        onSent={onSent}
      />
    </AbilityContext.Provider>,
  );
}

// Sends a test still holds when it ends: the lock is per draft and outlives
// the pane, so one left in flight would freeze every later test's Compose.
const heldSends = new Set<() => void>();

function holdSend() {
  let settle = {
    resolve: (_value: { conversationId: string; messageId: string }) => {},
    reject: (_error: Error) => {},
  };
  composeMock.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
        heldSends.add(() =>
          resolve({ conversationId: 'c-new', messageId: 'm-new' }),
        );
      }),
  );
  return {
    succeed: () =>
      act(async () => {
        heldSends.clear();
        settle.resolve({ conversationId: 'c-new', messageId: 'm-new' });
      }),
    fail: () =>
      act(async () => {
        heldSends.clear();
        settle.reject(new Error('Mail server unavailable'));
      }),
  };
}

async function pressSend(view: ReturnType<typeof renderCompose>, calls = 1) {
  await view.user.click(screen.getByRole('button', { name: 'Send body' }));
  await vi.waitFor(() => expect(composeMock).toHaveBeenCalledTimes(calls));
  return composeMock.mock.calls[calls - 1]?.[0];
}

describe('ComposeEmailPane — reopened while a send is in flight', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(`${DRAFT}-contact`, JSON.stringify('ct1'));
    window.localStorage.setItem(
      `${DRAFT}-mailbox`,
      JSON.stringify('cred-recruitment'),
    );
    window.localStorage.setItem(`${DRAFT}-subject`, JSON.stringify('Quote 7'));
    window.localStorage.setItem(BODY, JSON.stringify('Price list attached'));
    window.localStorage.setItem(IMPROVE, JSON.stringify('Keep it short'));
    // Drop a held send a failed test left queued, then answer at once again.
    composeMock.mockReset();
    composeMock.mockImplementation(async () => ({
      conversationId: 'c-new',
      messageId: 'm-new',
    }));
    editorSendFailedMock.mockClear();
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      for (const release of heldSends) release();
    });
    heldSends.clear();
    // Only a test that fails a send on purpose may leave a report behind.
    expect(editorSendFailedMock).not.toHaveBeenCalled();
  });

  it('keeps the reopened draft frozen, then clears it in place, so later edits survive', async () => {
    const send = holdSend();
    const onSentFirst = vi.fn();
    const first = renderCompose(onSentFirst);
    expect(await pressSend(first)).toMatchObject({
      subject: 'Quote 7',
      content: '<p>Price list attached</p>',
    });
    // Navigating away mid-send (another conversation, the mobile Back).
    first.unmount();

    const onSentReopened = vi.fn();
    const reopened = renderCompose(onSentReopened);
    const subject = screen.getByRole('textbox', { name: /Subject/ });
    expect(subject).toHaveValue('Quote 7');
    expect(subject).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Body' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send body' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByTestId('recipient-picker')).toHaveAttribute(
      'data-disabled',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent(SENDING);
    await reopened.user.type(subject, ' — newer unsent correction');
    expect(stored(`${DRAFT}-subject`)).toBe('Quote 7');

    await send.succeed();

    // The sent draft is gone from storage and from the reopened pane, which
    // stays put: the old send does not navigate away from it.
    expect(onSentFirst).not.toHaveBeenCalled();
    expect(onSentReopened).not.toHaveBeenCalled();
    expect(stored(`${DRAFT}-subject`)).toBeUndefined();
    expect(stored(`${DRAFT}-contact`)).toBeUndefined();
    expect(stored(BODY)).toBeUndefined();
    expect(stored(IMPROVE)).toBeUndefined();
    const fresh = screen.getByRole('textbox', { name: /Subject/ });
    expect(fresh).toHaveValue('');
    expect(fresh).toBeEnabled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    const body = screen.getByRole('textbox', { name: 'Body' });
    expect(body).toHaveValue('');

    await reopened.user.type(fresh, 'Newer unsent correction');
    await reopened.user.type(body, 'Next email');
    await act(async () => {});
    expect(stored(`${DRAFT}-subject`)).toBe('Newer unsent correction');
    expect(stored(BODY)).toBe('Next email');
    expect(fresh).toHaveValue('Newer unsent correction');
    expect(composeMock).toHaveBeenCalledTimes(1);
  });

  it('hands the draft back to the reopened pane when the send fails, for a retry', async () => {
    const send = holdSend();
    const onSentFirst = vi.fn();
    const first = renderCompose(onSentFirst);
    await pressSend(first);
    first.unmount();

    const onSentReopened = vi.fn();
    const reopened = renderCompose(onSentReopened);
    expect(screen.getByRole('textbox', { name: /Subject/ })).toBeDisabled();

    await send.fail();

    expect(editorSendFailedMock).toHaveBeenCalledTimes(1);
    editorSendFailedMock.mockClear();
    const subject = screen.getByRole('textbox', { name: /Subject/ });
    expect(subject).toBeEnabled();
    expect(subject).toHaveValue('Quote 7');
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveValue(
      'Price list attached',
    );
    expect(stored(`${DRAFT}-contact`)).toBe('ct1');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await reopened.user.type(subject, ' (revised)');
    expect(stored(`${DRAFT}-subject`)).toBe('Quote 7 (revised)');
    expect(await pressSend(reopened, 2)).toMatchObject({
      subject: 'Quote 7 (revised)',
      content: '<p>Price list attached</p>',
    });

    await vi.waitFor(() =>
      expect(onSentReopened).toHaveBeenCalledWith('c-new'),
    );
    expect(onSentFirst).not.toHaveBeenCalled();
    expect(stored(`${DRAFT}-subject`)).toBeUndefined();
    expect(stored(BODY)).toBeUndefined();
  });

  it('sends a pending draft once, from the first pane or a reopened one', async () => {
    const send = holdSend();
    const first = renderCompose();
    await pressSend(first);
    expect(screen.getByRole('button', { name: 'Send body' })).toBeDisabled();
    // A second send that gets past the button is refused, in this pane too.
    await act(async () => {
      await expect(
        editorSaveMock('<p>Price list attached</p>'),
      ).rejects.toThrow(SENDING);
    });
    first.unmount();

    const reopened = renderCompose();
    const sendButton = screen.getByRole('button', { name: 'Send body' });
    expect(sendButton).toBeDisabled();
    await reopened.user.click(sendButton);
    // Even a send that gets past the button is refused while the first one
    // is in flight, and leaves the draft as it was.
    await act(async () => {
      await expect(
        editorSaveMock('<p>Price list attached</p>'),
      ).rejects.toThrow(SENDING);
    });
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(stored(`${DRAFT}-subject`)).toBe('Quote 7');
    expect(stored(BODY)).toBe('Price list attached');
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveValue(
      'Price list attached',
    );

    await send.succeed();
    expect(composeMock).toHaveBeenCalledTimes(1);
  });
});
