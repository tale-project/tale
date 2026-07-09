// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const saveAgentMock = vi.fn();
const installAgentMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useSaveAgent: () => ({ mutateAsync: saveAgentMock }),
  useInstallCatalogAgent: () => ({ mutateAsync: installAgentMock }),
}));

vi.mock('../hooks/queries', () => ({
  useListAgents: () => ({ agents: [] }),
}));

vi.mock('./agent-create-dialog', () => ({
  CreateAgentDialog: () => null,
}));

// Capture the upload dialog's `onSaveOne` so the tests can drive the exact
// upload seam without a real file parse — the pairing under test lives in
// the callback, not in the dialog.
type SaveOne = (
  entry: { baseName: string; json: Record<string, unknown> },
  opts: { overwrite: boolean },
) => Promise<void>;
let capturedOnSaveOne: SaveOne | null = null;
vi.mock('@/app/features/shared/upload-configs/upload-configs-dialog', () => ({
  UploadConfigsDialog: (props: { onSaveOne: SaveOne }) => {
    capturedOnSaveOne = props.onSaveOne;
    return null;
  },
}));

import { AgentsActionMenu } from './agents-action-menu';

describe('AgentsActionMenu upload flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnSaveOne = null;
    saveAgentMock.mockResolvedValue({ hash: 'h' });
    installAgentMock.mockResolvedValue(null);
  });

  // Regression: the roster lists only INSTALLED agents (file ∩ enabled
  // install row), so an upload that writes the file without creating the
  // install row leaves the agent permanently invisible. The upload flow must
  // pair `saveAgent` with `installCatalogAgent`, same as Blank create.
  it('installs an uploaded agent so it appears in the installed-only roster', async () => {
    render(<AgentsActionMenu organizationId="org-1" />);
    expect(capturedOnSaveOne).not.toBeNull();

    await capturedOnSaveOne?.(
      { baseName: 'claude-code', json: { displayName: 'Claude Code' } },
      { overwrite: false },
    );

    expect(saveAgentMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      agentName: 'claude-code',
      isNew: true,
      config: { displayName: 'Claude Code' },
    });
    expect(installAgentMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      agentSlug: 'claude-code',
    });
  });

  it('keeps the uploaded file and logs when auto-install fails (e.g. non-admin)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installAgentMock.mockRejectedValueOnce(new Error('forbidden'));
    render(<AgentsActionMenu organizationId="org-1" />);
    expect(capturedOnSaveOne).not.toBeNull();

    await expect(
      capturedOnSaveOne?.(
        { baseName: 'claude-code', json: {} },
        { overwrite: true },
      ),
    ).resolves.toBeUndefined();

    expect(saveAgentMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
