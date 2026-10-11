// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DeployRefusedDialog } from './deploy-refused-dialog';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
}));

function renderDialog(openInEditor?: boolean) {
  const onClose = vi.fn();
  const view = render(
    <DeployRefusedDialog
      organizationId="org-1"
      automationSlug="ops/digest"
      refusal={{ version: 4, kind: 'testsFailing' }}
      onClose={onClose}
      {...(openInEditor !== undefined && { openInEditor })}
    />,
  );
  return { ...view, onClose };
}

describe('DeployRefusedDialog', () => {
  it('says why the version cannot go live and leads to it in the editor', () => {
    renderDialog();
    expect(
      screen.getByRole('dialog', { name: "v4 can't go live" }),
    ).toBeVisible();
    expect(
      screen.getByText("The tests of v4 fail, so it can't go live."),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Open v4 in the editor' }),
    ).toBeVisible();
  });

  it('leaves the editor link out where the version is already on screen', async () => {
    const { user, onClose } = renderDialog(false);
    expect(
      screen.queryByRole('link', { name: 'Open v4 in the editor' }),
    ).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    expect(onClose).toHaveBeenCalled();
  });
});
