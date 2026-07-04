import { type SearchSource } from '@tale/ui/search';
import { forwardRef, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { type ActorMentionData } from './actor-mention-popover';
import { ChatInput } from './chat-input';

// ChatInput pulls in the whole composer toolbar (agent/model pickers,
// dictation, governance footer) plus several Convex-backed hooks. This test
// exercises only the `@`-mention keyboard handling, so the heavy children and
// data hooks are stubbed to no-ops — the same tier-down approach as
// composer-mode-menu.test.tsx.
vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({ quotedText: null, setQuotedText: vi.fn() }),
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: () => ({ policyEnabled: false, allowedExtensions: [] }),
}));
vi.mock('../hooks/use-video-url-ingest', () => ({
  useVideoUrlIngest: () => ({ pending: false, ingest: vi.fn() }),
}));
vi.mock('./arena/arena-mode-context', () => ({
  useArenaModeOptional: () => null,
}));
vi.mock('./composer-mode-menu', () => ({ ComposerModeMenu: () => null }));
vi.mock('./dictation-button', () => ({
  DictationButton: forwardRef(() => null),
}));
vi.mock('@/app/features/governance/components/data-notice-footer', () => ({
  DataNoticeFooter: () => null,
}));
// The KB source is instantiated unconditionally (fixed hook order) and reaches
// Convex — stub it to an idle no-op source; this test drives the actor picker.
vi.mock('./documents-mention-source', () => ({
  createDocumentsMentionSource: () => () => ({ results: [], status: 'idle' }),
}));
// FileUpload.DropZone reads a Root context that ChatInput's caller supplies in
// production; render it (and its overlay) as plain passthroughs here.
vi.mock('@/app/components/ui/forms/file-upload', () => ({
  FileUpload: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropZone: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Overlay: () => null,
  },
}));

// The send-gate tests below assert a blocked Enter toasts instead of sending.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// Actor source that never matches — reproduces the "No matches" empty state.
const emptyActorSource: SearchSource<ActorMentionData> = () => ({
  results: [],
  status: 'ready',
});

function Harness({
  onSendMessage,
}: {
  onSendMessage: (message: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <ChatInput
      value={value}
      onChange={setValue}
      onSendMessage={onSendMessage}
      organizationId="org-1"
      attachments={[]}
      uploadingFiles={[]}
      uploadFiles={vi.fn()}
      removeAttachment={vi.fn()}
      clearAttachments={() => []}
      actorMentionSource={emptyActorSource}
      variant="assistant"
    />
  );
}

describe('ChatInput @-mention keyboard handling', () => {
  it('swallows Enter on the "No matches" empty picker instead of sending', async () => {
    const onSendMessage = vi.fn();
    const { user } = render(<Harness onSendMessage={onSendMessage} />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, '@zzzz');

    // Picker is open on its empty state.
    expect(screen.getByText('No matches')).toBeInTheDocument();

    // Enter must NOT publish the literal query, and it dismisses the picker.
    await user.keyboard('{Enter}');
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();

    // With the picker dismissed, a second Enter sends as usual.
    await user.keyboard('{Enter}');
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('@zzzz', undefined, undefined);
  });
});

const BUDGET_REASON = 'Your usage limit has been reached for this period.';

function renderInput(overrides?: Partial<Parameters<typeof ChatInput>[0]>) {
  const onSendMessage = vi.fn();
  const utils = render(
    <ChatInput
      organizationId="org-1"
      value="over-budget message"
      onChange={vi.fn()}
      onSendMessage={onSendMessage}
      attachments={[]}
      uploadingFiles={[]}
      uploadFiles={vi.fn()}
      removeAttachment={vi.fn()}
      clearAttachments={vi.fn(() => [])}
      variant="assistant"
      sendBlocked
      sendBlockedReason={BUDGET_REASON}
      {...overrides}
    />,
  );
  return { ...utils, onSendMessage };
}

// #2345 regression: budget enforcement used to be server-side only, so the
// composer left Send enabled and pressing Enter was a silent no-op. The client
// now feeds the budget-exceeded state into ChatInput's `sendBlocked`/
// `sendBlockedReason` gate (chat-interface).
describe('ChatInput send gate', () => {
  it('states the block reason and disables Send when sendBlocked', () => {
    renderInput();

    expect(screen.getByRole('status')).toHaveTextContent(BUDGET_REASON);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('turns a keyboard Enter into a toast instead of sending', async () => {
    mockToast.mockClear();
    const { user, onSendMessage } = renderInput();

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: BUDGET_REASON,
      variant: 'destructive',
    });
  });

  it('sends normally once the block clears', async () => {
    const { user, onSendMessage } = renderInput({
      sendBlocked: false,
      sendBlockedReason: undefined,
    });

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');

    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });
});
