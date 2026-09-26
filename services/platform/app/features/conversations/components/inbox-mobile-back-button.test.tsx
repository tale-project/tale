// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

const ORG = 'test-org';
const BACK_LABEL = 'common.aria.back';

let mockSearch: {
  conversation?: string;
  compose?: string;
  composeContact?: string;
} = {};
let mockParams: { id?: string; status?: string } = {
  id: ORG,
  status: 'open',
};
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
  useSearch: () => mockSearch,
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

import { InboxMobileBackButton } from './inbox-mobile-back-button';

beforeEach(() => {
  mockNavigate.mockClear();
  mockSearch = {};
  mockParams = { id: ORG, status: 'open' };
});

describe('InboxMobileBackButton', () => {
  it('renders nothing on the list (no conversation or compose)', () => {
    render(<InboxMobileBackButton />);
    expect(screen.queryByRole('button', { name: BACK_LABEL })).toBeNull();
  });

  it('leads back to the Home list from an open conversation', async () => {
    mockSearch = { conversation: 'conv-1' };
    const { user } = render(<InboxMobileBackButton />);

    const back = screen.getByRole('button', { name: BACK_LABEL });
    expect(back).toHaveClass('md:hidden');
    await user.click(back);

    // A phone keeps every conversation in the Home list (its Inbox view
    // carries the statuses and bulk verbs), so back goes there.
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/home',
      params: { id: ORG },
    });
  });

  it('shows while composing and leads back to Home', async () => {
    mockSearch = { compose: 'new', composeContact: 'contact-1' };
    const { user } = render(<InboxMobileBackButton />);

    await user.click(screen.getByRole('button', { name: BACK_LABEL }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/home',
      params: { id: ORG },
    });
  });

  it('passes the accessibility audit when visible', async () => {
    mockSearch = { compose: 'new' };
    const { container } = render(<InboxMobileBackButton />);
    await checkAccessibility(container);
  });
});
