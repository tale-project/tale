import { forwardRef, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { MentionActorOption } from '../../tasks/lib/mention-actor-options';
import type { KbDocumentMention, KbMention } from '../hooks/use-kb-mentions';
import { ChatInput } from './chat-input';

// ChatInput pulls in the whole composer toolbar (agent/model pickers,
// dictation, governance footer) plus several Convex-backed hooks. These tests
// exercise only the `@`-mention machinery and the send gate, so the heavy
// children and data hooks are stubbed to no-ops — the same tier-down approach
// as composer-mode-menu.test.tsx.
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
// The empty-state action rows navigate ("Invite teammates", "Upload
// documents"); there is no RouterProvider in these tests. `Link` backs
// `ProviderKeyErrorAction`'s `LinkButton` (the missing-API-key disabled-reason
// action) — same no-op-anchor mock pattern as other route-less component tests.
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => (
    // Router-Link test double, not real navigation — same suppression as the
    // other route-less component tests' anchor stub.
    // oxlint-disable-next-line jsx-a11y/anchor-is-valid
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));
// `ProviderKeyErrorAction` (rendered in the missing-API-key disabled state)
// gates its "Open provider settings" link on this ability; default to an
// admin so the picker/send-gate tests above (which never touch this path)
// aren't affected, and the disabled-composer tests below flip it per case.
const mockCan = vi.fn(() => true);
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: mockCan }),
}));
// The KB source is instantiated unconditionally (fixed hook order) and reaches
// Convex — replace it with a source that serves this mutable state (idle by
// default; the cross-section test flips it to a canned result).
let documentsSourceState: {
  results: { id: string; title: string; subtitle?: string; data: KbMention }[];
  status: 'idle' | 'loading' | 'ready';
} = { results: [], status: 'idle' };
vi.mock('./documents-mention-source', () => ({
  createDocumentsMentionSource: () => () => documentsSourceState,
}));
// Folder mention source mirrors the documents one; default to no results so
// existing picker tests keep their section layout.
vi.mock('./folders-mention-source', () => ({
  createFoldersMentionSource: () => () => ({
    results: [],
    status: 'ready',
  }),
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
// The mention popover portals through the anchored shell (needs layout
// measurements JSDOM doesn't do) — render its children inline instead.
vi.mock('./anchored-mention-popover-shell', () => ({
  AnchoredMentionPopoverShell: ({
    open,
    children,
  }: {
    open: boolean;
    children?: ReactNode;
  }) =>
    open ? <div data-testid="mention-popover-shell">{children}</div> : null,
}));

// The send-gate tests below assert a blocked Enter toasts instead of sending.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

const actorOptions: MentionActorOption[] = [
  {
    type: 'user',
    id: 'user-1',
    name: 'Alice Smith',
    email: 'alice@example.com',
    handle: 'alice',
  },
  { type: 'agent', id: 'helper-bot', name: 'Helper Bot', handle: 'helper-bot' },
];

const kbDocument: KbMention = {
  kind: 'document',
  documentId: 'doc_1' as KbDocumentMention['documentId'],
  fileId: 'file_1' as KbDocumentMention['fileId'],
  title: 'Quarterly Report',
  fileType: 'application/pdf',
  fileSize: 100,
};

function Harness({
  onSendMessage,
  actorMentionOptions,
  addKbMention,
}: {
  onSendMessage: (message: string) => void;
  actorMentionOptions?: MentionActorOption[];
  /** Wiring this also wires the rest of the KB contract (documents section). */
  addKbMention?: (mention: KbMention) => boolean;
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
      actorMentionOptions={actorMentionOptions}
      kbMentions={addKbMention ? [] : undefined}
      addKbMention={addKbMention}
      removeKbMention={addKbMention ? vi.fn() : undefined}
      clearKbMentions={addKbMention ? () => [] : undefined}
      variant="assistant"
    />
  );
}

describe('ChatInput @-mention picker', () => {
  it('swallows Enter on the "No matches" empty picker instead of sending', async () => {
    const onSendMessage = vi.fn();
    const { user } = render(
      <Harness onSendMessage={onSendMessage} actorMentionOptions={[]} />,
    );

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

  it('inserts @handle on actor select and renders a removable chip', async () => {
    const onSendMessage = vi.fn();
    const { user } = render(
      <Harness
        onSendMessage={onSendMessage}
        actorMentionOptions={actorOptions}
      />,
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, '@ali');

    // Alice matches; Enter accepts the highlighted option.
    expect(
      screen.getByRole('option', { name: /Alice Smith/ }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(textarea).toHaveValue('@alice ');

    // The accepted mention is confirmed with a chip…
    const removeChip = screen.getByRole('button', {
      name: 'Remove mention of Alice Smith',
    });
    // …whose removal strips the handle from the text again.
    await user.click(removeChip);
    expect(textarea).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Remove mention of Alice Smith' }),
    ).not.toBeInTheDocument();
  });

  it('groups actors into Agents and Teammates sections', async () => {
    const { user } = render(
      <Harness onSendMessage={vi.fn()} actorMentionOptions={actorOptions} />,
    );

    await user.click(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), '@');

    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Teammates')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Helper Bot/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Alice Smith/ }),
    ).toBeInTheDocument();
  });

  it('offers actionable empty states reachable by keyboard', async () => {
    mockNavigate.mockClear();
    const onSendMessage = vi.fn();
    const { user } = render(
      <Harness onSendMessage={onSendMessage} actorMentionOptions={[]} />,
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, '@');

    // Each empty section explains itself and offers the next step.
    expect(
      screen.getByText('No agents in this project yet'),
    ).toBeInTheDocument();
    expect(screen.getByText('No teammates to mention yet')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Browse agents' }),
    ).toBeInTheDocument();

    // The action rows are options in the same keyboard navigation.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/organization',
      params: { id: 'org-1' },
    });
    // Activating an action never inserts or sends anything.
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('@');
  });

  it('navigates across sections and pins a document chip via addKbMention', async () => {
    documentsSourceState = {
      results: [{ id: 'doc_1', title: kbDocument.title, data: kbDocument }],
      status: 'ready',
    };
    try {
      const addKbMention = vi.fn(() => true);
      const { user } = render(
        <Harness
          onSendMessage={vi.fn()}
          actorMentionOptions={actorOptions}
          addKbMention={addKbMention}
        />,
      );

      const textarea = screen.getByRole('textbox');
      await user.click(textarea);
      await user.type(textarea, '@');

      // One picker, all three sections.
      expect(screen.getByText('Agents')).toBeInTheDocument();
      expect(screen.getByText('Teammates')).toBeInTheDocument();
      expect(screen.getByText('Documents')).toBeInTheDocument();

      // Flat order: Helper Bot (agent), Alice (teammate), the document.
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
      expect(addKbMention).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc_1' }),
      );
      expect(textarea).toHaveValue('@Quarterly Report ');
    } finally {
      documentsSourceState = { results: [], status: 'idle' };
    }
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

const NO_API_KEY_MESSAGE =
  "No API key configured for this model's provider — add one in Settings → AI providers.";

function renderDisabledForMissingApiKey(
  overrides?: Partial<Parameters<typeof ChatInput>[0]>,
) {
  const onSendMessage = vi.fn();
  const utils = render(
    <ChatInput
      organizationId="org-1"
      value=""
      onChange={vi.fn()}
      onSendMessage={onSendMessage}
      attachments={[]}
      uploadingFiles={[]}
      uploadFiles={vi.fn()}
      removeAttachment={vi.fn()}
      clearAttachments={vi.fn(() => [])}
      variant="assistant"
      disabled
      disabledReason="no-api-key"
      disabledMessage={NO_API_KEY_MESSAGE}
      {...overrides}
    />,
  );
  return { ...utils, onSendMessage };
}

// #2576 regression: the composer used to stay fully editable when the
// selected model's provider had no API key — `sendBlocked` left the textarea
// itself enabled (typing/pasting still worked) and a keyboard Enter was a
// silent no-op. Missing API key is now a hard `disabled` state (like
// no-agents/archived), so the reason is visible on an EMPTY composer without
// typing first, and a native `disabled` textarea can't receive keyboard
// input at all — there is no Enter to swallow.
describe('ChatInput disabled composer (missing API key)', () => {
  it('disables the textarea and shows the reason on an empty composer', () => {
    renderDisabledForMissingApiKey();

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveValue('');
    expect(screen.getByText(NO_API_KEY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('hides textarea glyphs when a draft sits under the disabled overlay', () => {
    // Regression: a conversation-starter fill (or restored draft) left real
    // text in the disabled textarea while the absolute "No API key…" overlay
    // painted on top — the two stacked and read as garbled overlap.
    renderDisabledForMissingApiKey({
      value: 'Help me write a clear, professional email',
    });

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveClass('text-transparent');
    expect(screen.getByText(NO_API_KEY_MESSAGE)).toBeInTheDocument();
  });

  it('shows the actionable Settings link for an admin', () => {
    mockCan.mockReturnValue(true);
    renderDisabledForMissingApiKey();

    expect(
      screen.getByRole('link', { name: 'Open provider settings' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ask an admin/i)).not.toBeInTheDocument();
  });

  it('shows an "ask an admin" hint instead of a link for a member', () => {
    mockCan.mockReturnValue(false);
    renderDisabledForMissingApiKey();

    expect(
      screen.getByText(
        'Ask an admin to add an API key in Settings → AI providers.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open provider settings' }),
    ).not.toBeInTheDocument();
  });
});

describe('ChatInput disabled composer (no agents)', () => {
  function renderDisabledForNoAgents() {
    return render(
      <ChatInput
        organizationId="org-1"
        value=""
        onChange={vi.fn()}
        onSendMessage={vi.fn()}
        attachments={[]}
        uploadingFiles={[]}
        uploadFiles={vi.fn()}
        removeAttachment={vi.fn()}
        clearAttachments={vi.fn(() => [])}
        variant="assistant"
        disabled
        disabledReason="no-agents"
      />,
    );
  }

  it('shows honest copy without telling anyone to "publish" an agent', () => {
    mockCan.mockReturnValue(true);
    renderDisabledForNoAgents();

    expect(screen.getByText('No agents available yet.')).toBeInTheDocument();
    expect(screen.queryByText(/publish/i)).not.toBeInTheDocument();
  });

  it('shows Browse agents for an admin who can install agents', () => {
    mockCan.mockReturnValue(true);
    renderDisabledForNoAgents();

    expect(
      screen.getByRole('link', { name: 'Browse agents' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ask an admin/i)).not.toBeInTheDocument();
  });

  it('shows an ask-admin hint instead of a link for a member', () => {
    mockCan.mockReturnValue(false);
    renderDisabledForNoAgents();

    expect(
      screen.getByText(
        'Ask an admin to install an agent so you can start chatting.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Browse agents' }),
    ).not.toBeInTheDocument();
  });
});

const ARCHIVED_CHAT_COPY =
  'This chat is archived. Unarchive it to continue the conversation.';
const LOCKED_DISCUSSION_COPY = 'This discussion is locked';

function renderDisabledComposer(
  overrides?: Partial<Parameters<typeof ChatInput>[0]>,
) {
  return render(
    <ChatInput
      organizationId="org-1"
      value=""
      onChange={vi.fn()}
      onSendMessage={vi.fn()}
      attachments={[]}
      uploadingFiles={[]}
      uploadFiles={vi.fn()}
      removeAttachment={vi.fn()}
      clearAttachments={vi.fn(() => [])}
      variant="assistant"
      disabled
      {...overrides}
    />,
  );
}

// #2680 regression: locking a discussion used to reuse `disabledReason=
// "archived"`, so the composer explained itself with CHAT's archived copy
// ("This chat is archived…") instead of the discussions locked notice. The
// dedicated `'locked'` reason renders the caller-supplied `disabledMessage`
// (the caller owns that copy — ChatInput has no discussions vocabulary),
// while `'archived'` keeps chat's fixed wording byte-identical.
describe('ChatInput disabled composer (archived vs locked)', () => {
  it('keeps chat\'s fixed copy for disabledReason="archived"', () => {
    renderDisabledComposer({ disabledReason: 'archived' });

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByText(ARCHIVED_CHAT_COPY)).toBeInTheDocument();
  });

  it('renders the caller-supplied message for disabledReason="locked"', () => {
    renderDisabledComposer({
      disabledReason: 'locked',
      disabledMessage: LOCKED_DISCUSSION_COPY,
    });

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByText(LOCKED_DISCUSSION_COPY)).toBeInTheDocument();
    // Neither chat's archived copy nor the no-agents fallback may leak in.
    expect(screen.queryByText(ARCHIVED_CHAT_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(/No agents available/)).not.toBeInTheDocument();
  });
});
