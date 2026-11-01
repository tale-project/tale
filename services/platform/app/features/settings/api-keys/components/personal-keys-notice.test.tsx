import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { PersonalKeysNotice } from './personal-keys-notice';

/**
 * The API keys page tells a member when the keys they make for themselves
 * do not work in this organization — refused at `/api/v1` with nothing on
 * the page that made them saying so otherwise.
 */

const { readSpy, state } = vi.hoisted(() => ({
  readSpy: vi.fn(),
  // Mutable, hoisted so the mock factory can read it (vi.mock is hoisted
  // above imports). `answer: undefined` is a read still on its way.
  state: {
    answer: undefined as
      | {
          mayCreate: boolean;
          holdsKeys: boolean;
          personalKeys?: 'admitted' | 'refused' | 'unavailable';
        }
      | undefined,
  },
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyApiKeyAccess: (organizationId: string) => {
    readSpy(organizationId);
    return { data: state.answer };
  },
}));

const REFUSED_TITLE = "Your own keys don't work here";
const UNAVAILABLE_TITLE = 'Your own keys are paused here';

beforeEach(() => {
  state.answer = { mayCreate: true, holdsKeys: true, personalKeys: 'refused' };
  readSpy.mockClear();
});

describe('PersonalKeysNotice', () => {
  it('says the organization refuses the keys members make for themselves', () => {
    render(<PersonalKeysNotice organizationId="org-1" />);

    expect(readSpy).toHaveBeenCalledWith('org-1');
    expect(
      screen.getByRole('heading', { name: REFUSED_TITLE }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /This organization refuses the API keys members make for themselves\. They keep working in your other organizations; an Owner or Admin here can make a key for you\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: UNAVAILABLE_TITLE }),
    ).not.toBeInTheDocument();
  });

  it('says the keys are paused while the setting cannot be read', () => {
    state.answer = {
      mayCreate: true,
      holdsKeys: false,
      personalKeys: 'unavailable',
    };
    render(<PersonalKeysNotice organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: UNAVAILABLE_TITLE }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Tale can't read whether this organization accepts members' own API keys, so they are refused here until it can\. Try again shortly\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: REFUSED_TITLE }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['the read has not answered', undefined],
    [
      'their own keys work here',
      { mayCreate: true, holdsKeys: true, personalKeys: 'admitted' as const },
    ],
    ['the answer does not say', { mayCreate: true, holdsKeys: true }],
  ])('says nothing while %s', (_label, answer) => {
    state.answer = answer;
    const { container } = render(<PersonalKeysNotice organizationId="org-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is a static banner, not a live announcement, and passes axe', async () => {
    const { container } = render(<PersonalKeysNotice organizationId="org-1" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await checkAccessibility(container);
  });
});
