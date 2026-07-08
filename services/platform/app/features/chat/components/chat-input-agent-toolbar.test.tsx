import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ChatInput } from './chat-input';

// #2488 regression: the agent/model/sandbox cluster used gap={1}, which left
// the read-only "Default model" label visually flush against the Sandbox badge
// when ExternalAgentModeToggle is hidden. Stub the heavy children so we can
// assert the cluster's layout gap in isolation.
vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({ quotedText: null, setQuotedText: vi.fn() }),
}));
// The mention picker's empty-state actions navigate; no RouterProvider here.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
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
vi.mock('./dictation-button', () => ({ DictationButton: () => null }));
vi.mock('@/app/features/governance/components/data-notice-footer', () => ({
  DataNoticeFooter: () => null,
}));
vi.mock('./documents-mention-source', () => ({
  createDocumentsMentionSource: () => () => ({ results: [], status: 'idle' }),
}));
vi.mock('./folders-mention-source', () => ({
  createFoldersMentionSource: () => () => ({
    results: [],
    status: 'ready',
  }),
}));
vi.mock('@/app/components/ui/forms/file-upload', () => ({
  FileUpload: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropZone: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Overlay: () => null,
  },
}));
vi.mock('./agent-selector', () => ({
  AgentSelector: () => <div data-testid="agent-selector-stub" />,
}));
vi.mock('./model-selector', () => ({
  ModelSelector: () => <div data-testid="model-selector-stub" />,
}));
vi.mock('./external-agent-mode-toggle', () => ({
  ExternalAgentModeToggle: () => null,
}));
vi.mock('./sandbox-chip', () => ({
  SandboxChip: () => <div data-testid="sandbox-stub" />,
}));
vi.mock('./sandbox-workdir-chip', () => ({
  SandboxWorkdirChip: () => null,
}));
vi.mock('./composer-capability-pills', () => ({
  ComposerCapabilityPills: () => null,
}));
vi.mock('./voice-mode-toggle', () => ({
  VoiceModeToggle: () => null,
}));

describe('ChatInput agent toolbar spacing', () => {
  it('uses gap-2 between agent, model, and sandbox controls (#2488)', () => {
    render(
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
        variant="full"
      />,
    );

    const agentStub = screen.getByTestId('agent-selector-stub');
    const cluster = agentStub.parentElement;

    expect(cluster).toHaveClass('gap-2');
    expect(cluster).toContainElement(screen.getByTestId('model-selector-stub'));
    expect(cluster).toContainElement(screen.getByTestId('sandbox-stub'));
  });
});
