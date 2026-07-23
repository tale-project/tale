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

vi.mock('@/lib/i18n/client', () => ({
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

  it('clears the conversation search param on back', async () => {
    mockSearch = { conversation: 'conv-1' };
    const { user } = render(<InboxMobileBackButton />);

    const back = screen.getByRole('button', { name: BACK_LABEL });
    expect(back).toHaveClass('md:hidden');
    await user.click(back);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/conversations/$status',
      params: { id: ORG, status: 'open' },
      search: expect.any(Function),
      replace: true,
    });
    const searchUpdater = mockNavigate.mock.calls[0]?.[0]?.search as (prev: {
      conversation?: string;
      compose?: string;
      composeContact?: string;
    }) => {
      conversation?: string;
      compose?: string;
      composeContact?: string;
    };
    expect(searchUpdater({ conversation: 'conv-1' })).toEqual({
      conversation: undefined,
      compose: undefined,
      composeContact: undefined,
    });
  });

  it('shows while composing and clears compose params on back', async () => {
    mockSearch = { compose: 'new', composeContact: 'contact-1' };
    const { user } = render(<InboxMobileBackButton />);

    await user.click(screen.getByRole('button', { name: BACK_LABEL }));

    const searchUpdater = mockNavigate.mock.calls[0]?.[0]?.search as (prev: {
      conversation?: string;
      compose?: string;
      composeContact?: string;
    }) => {
      conversation?: string;
      compose?: string;
      composeContact?: string;
    };
    expect(
      searchUpdater({
        compose: 'new',
        composeContact: 'contact-1',
      }),
    ).toEqual({
      conversation: undefined,
      compose: undefined,
      composeContact: undefined,
    });
  });

  it('passes the accessibility audit when visible', async () => {
    mockSearch = { compose: 'new' };
    const { container } = render(<InboxMobileBackButton />);
    await checkAccessibility(container);
  });
});
