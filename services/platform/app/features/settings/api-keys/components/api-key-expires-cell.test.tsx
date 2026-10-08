import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ApiKeyExpiresCell } from './api-key-expires-cell';

describe('ApiKeyExpiresCell', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 9, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the day a key expires on', () => {
    render(<ApiKeyExpiresCell expiresAt={new Date(2026, 10, 6, 9, 0)} />);
    expect(screen.getByText('11/06/2026')).toBeInTheDocument();
  });

  it('reads an expiry the list delivered as text', () => {
    render(
      <ApiKeyExpiresCell
        expiresAt={new Date(2026, 10, 6, 9, 0).toISOString()}
      />,
    );
    expect(screen.getByText('11/06/2026')).toBeInTheDocument();
  });

  it('says Never for a key without an expiry', () => {
    render(<ApiKeyExpiresCell expiresAt={null} />);
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('says Expired once the day has passed', () => {
    render(<ApiKeyExpiresCell expiresAt={new Date(2026, 9, 7, 8, 59)} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('10/07/2026')).not.toBeInTheDocument();
  });
});
