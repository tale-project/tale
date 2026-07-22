import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ChatInput } from './chat-input';

// Toggled per test: desktop keeps the two separate pickers; mobile collapses
// them into one combined control.
const { mobileState } = vi.hoisted(() => ({ mobileState: { value: false } }));
vi.mock('@/app/hooks/use-is-mobile', () => ({
  useIsMobile: () => mobileState.value,
}));

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
// Stub the pickers + combined control so we can assert the toolbar's layout
// (each has its own unit test for behaviour).
vi.mock('./agent-selector', () => ({
  AgentSelector: () => <div data-testid="agent-selector-stub" />,
}));
vi.mock('./model-selector', () => ({
  ModelSelector: () => <div data-testid="model-selector-stub" />,
}));
vi.mock('./assistant-model-selector', () => ({
  AssistantModelSelector: () => <div data-testid="assistant-model-stub" />,
}));
vi.mock('./external-agent-mode-toggle', () => ({
  ExternalAgentModeToggle: () => null,
}));
vi.mock('./sandbox-chip', () => ({
  SandboxChip: () => <div data-testid="sandbox-stub" />,
}));
vi.mock('./composer-capability-pills', () => ({
  ComposerCapabilityPills: () => null,
}));
vi.mock('./voice-mode-toggle', () => ({
  VoiceModeToggle: () => null,
}));

describe('ChatInput agent toolbar', () => {
  beforeEach(() => {
    mobileState.value = false;
  });

  function renderToolbar() {
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
  }

  it('desktop: keeps the two separate pickers, gap-2 from the sandbox control (#2488)', () => {
    renderToolbar();
    // #2488: the read-only "Default model" label must not sit flush against the
    // Sandbox badge when ExternalAgentModeToggle is hidden.
    const agent = screen.getByTestId('agent-selector-stub');
    const cluster = agent.parentElement;
    expect(cluster).toHaveClass('gap-2');
    expect(cluster).toContainElement(screen.getByTestId('model-selector-stub'));
    expect(cluster).toContainElement(screen.getByTestId('sandbox-stub'));
    // Desktop is untouched — no combined control.
    expect(
      screen.queryByTestId('assistant-model-stub'),
    ).not.toBeInTheDocument();
  });

  it('mobile: collapses the two pickers into one combined control', () => {
    mobileState.value = true;
    renderToolbar();
    expect(screen.getByTestId('assistant-model-stub')).toBeInTheDocument();
    // The two separate pickers are not rendered on the cramped mobile row.
    expect(screen.queryByTestId('agent-selector-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-selector-stub')).not.toBeInTheDocument();
  });
});
