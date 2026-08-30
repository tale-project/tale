import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DataNoticeFooter } from './data-notice-footer';

// Drives the mocked `useBackendQuery` return. `undefined` data models the
// loading (or skipped) state; `null` models a resolved read with no stored
// policy row; an object models a resolved policy.
const { state } = vi.hoisted(() => ({
  state: { data: undefined as unknown },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: state.data }),
}));

function noticeEl() {
  return screen.queryByRole('note', { name: /confidentiality notice/i });
}

describe('DataNoticeFooter', () => {
  it('renders nothing while the policy query is loading (#2376)', () => {
    // Regression: defaulting to enabled during load caused a show→hide flash
    // for orgs whose stored policy resolves to disabled.
    state.data = undefined;
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).not.toBeInTheDocument();
  });

  it('renders the notice for an org with no stored policy (product default on)', () => {
    state.data = null;
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).toBeInTheDocument();
  });

  it('renders the notice when the resolved policy enables it', () => {
    state.data = { config: { enabled: true } };
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).toBeInTheDocument();
  });

  it('renders nothing when the resolved policy disables it — stable, no flash', () => {
    state.data = { config: { enabled: false } };
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).not.toBeInTheDocument();
  });
});
