import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ComposerModeMenu } from './composer-mode-menu';

// Migrated from the `chat-features` E2E "composer mode menu lists the add-files
// entry": opening the "+" menu and seeing the attach-files item is pure menu
// UI (the entry is gated only on `onAttachFile` + `!fileUploadDisabled`, both
// props), so it belongs at the component tier. The menu reads several chat
// hooks for its other groups; we stub them to their empty/no-op states so only
// the attach group renders, then assert the same item the E2E did.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    setSelectedAgent: vi.fn(),
    enabledCapabilities: [],
    setCapabilityEnabled: vi.fn(),
  }),
}));

vi.mock('../hooks/queries', () => ({
  useChatAgents: () => ({ agents: [] }),
}));

vi.mock('../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({ agent: null }),
}));

vi.mock('../hooks/use-composer-capabilities', () => ({
  useComposerCapabilities: () => [],
  useIntegrationReadiness: () => ({ titleBySlug: new Map() }),
  getAgentMissingIntegrations: () => [],
  resolveCapabilityIcon: () => undefined,
}));

vi.mock('../hooks/use-sandbox-panes', () => ({
  useSandboxPanesAvailable: () => false,
}));

vi.mock('./arena/arena-mode-context', () => ({
  useArenaModeOptional: () => null,
}));

vi.mock('@/app/features/workspace/components/workspace-files-context', () => ({
  useWorkspaceFilesOptional: () => null,
}));

vi.mock('@/app/features/workspace/components/live-browser-context', () => ({
  useLiveBrowserOptional: () => null,
}));

vi.mock('@/app/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}));

describe('ComposerModeMenu', () => {
  it('lists the add-files entry when an attach handler is wired', async () => {
    const onAttachFile = vi.fn();
    const { user } = render(
      <ComposerModeMenu
        organizationId="org-1"
        onAttachFile={onAttachFile}
        fileUploadDisabled={false}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Open composer menu' }),
    );

    expect(
      await screen.findByRole('menuitem', { name: 'Add photos & files' }),
    ).toBeInTheDocument();
  });

  it('renders nothing when no menu groups are available', () => {
    // No attach handler and no agents/capabilities → the menu has zero groups
    // and the component returns null (the "+" trigger never mounts).
    const { container } = render(
      <ComposerModeMenu organizationId="org-1" fileUploadDisabled={true} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
