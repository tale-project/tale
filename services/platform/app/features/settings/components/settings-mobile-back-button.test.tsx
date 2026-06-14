// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

const ORG = 'test-org';
const BACK_LABEL = 'common.aria.back';

let mockPathname = `/dashboard/${ORG}/settings`;
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  // Simple passthroughs — the component only reads location + navigate; `Link`
  // is provided so the shared AppShell wrapper (test render util) stays happy.
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

import { SettingsMobileBackButton } from './settings-mobile-back-button';

beforeEach(() => {
  mockNavigate.mockClear();
});

describe('SettingsMobileBackButton', () => {
  it('renders nothing on the workspace overview', () => {
    mockPathname = `/dashboard/${ORG}/settings`;
    render(<SettingsMobileBackButton organizationId={ORG} />);
    expect(screen.queryByRole('button', { name: BACK_LABEL })).toBeNull();
  });

  it('renders nothing on the personal overview', () => {
    mockPathname = `/dashboard/${ORG}/settings/personal`;
    render(<SettingsMobileBackButton organizationId={ORG} />);
    expect(screen.queryByRole('button', { name: BACK_LABEL })).toBeNull();
  });

  it('renders nothing outside the settings section', () => {
    mockPathname = `/dashboard/${ORG}/documents`;
    render(<SettingsMobileBackButton organizationId={ORG} />);
    expect(screen.queryByRole('button', { name: BACK_LABEL })).toBeNull();
  });

  it('returns to the workspace overview from a workspace sub-page', async () => {
    mockPathname = `/dashboard/${ORG}/settings/branding`;
    const { user } = render(<SettingsMobileBackButton organizationId={ORG} />);
    await user.click(screen.getByRole('button', { name: BACK_LABEL }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings',
      params: { id: ORG },
    });
  });

  it('returns to the workspace overview from a nested governance sub-page', async () => {
    mockPathname = `/dashboard/${ORG}/settings/governance/audit-logs`;
    const { user } = render(<SettingsMobileBackButton organizationId={ORG} />);
    await user.click(screen.getByRole('button', { name: BACK_LABEL }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings',
      params: { id: ORG },
    });
  });

  it('returns to the personal overview from a personal sub-page', async () => {
    mockPathname = `/dashboard/${ORG}/settings/account`;
    const { user } = render(<SettingsMobileBackButton organizationId={ORG} />);
    await user.click(screen.getByRole('button', { name: BACK_LABEL }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/personal',
      params: { id: ORG },
    });
  });

  it('passes the accessibility audit', async () => {
    mockPathname = `/dashboard/${ORG}/settings/branding`;
    const { container } = render(
      <SettingsMobileBackButton organizationId={ORG} />,
    );
    await checkAccessibility(container);
  });
});
