import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { useReinstallWithPreflight } from './use-reinstall-with-preflight';

const { previewSpy, reinstallSpy } = vi.hoisted(() => ({
  previewSpy: vi.fn(),
  reinstallSpy: vi.fn(),
}));

vi.mock('./use-install-state', () => ({
  useAutomationInstallActions: () => ({
    preview: previewSpy,
    reinstall: reinstallSpy,
    isPending: false,
  }),
  isInstallOverridesError: () => false,
}));

/** Mounts the hook and immediately requests a reinstall for `automationSlug`. */
function Host({ automationSlug }: { automationSlug: string }) {
  const { requestReinstall, dialog } = useReinstallWithPreflight('org_1');
  useEffect(() => {
    void requestReinstall(automationSlug);
    // Fire once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return dialog;
}

beforeEach(() => {
  previewSpy.mockReset();
  reinstallSpy.mockReset();
  reinstallSpy.mockResolvedValue(undefined);
});

describe('useReinstallWithPreflight — override filtering', () => {
  it('still requires confirmation for a real (non-exempt) override', async () => {
    previewSpy.mockResolvedValue({
      entries: [
        {
          domain: 'automation',
          path: 'agents/helper.json',
          kind: 'agent',
          slug: 'desk/helper',
          status: 'override',
        },
      ],
      overrides: ['automation:agents/helper.json'],
    });
    const { user } = render(<Host automationSlug="desk" />);

    await screen.findByText('Reinstall automation');
    expect(screen.getByText('desk/helper')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reinstall' })).toBeDisabled();

    await user.click(
      screen.getByRole('checkbox', {
        name: "Replace these files with the automation's versions",
      }),
    );
    expect(screen.getByRole('button', { name: 'Reinstall' })).toBeEnabled();
  });
});
