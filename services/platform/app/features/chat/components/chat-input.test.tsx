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
    DropZone: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Overlay: () => null,
  },
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
