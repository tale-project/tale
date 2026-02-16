import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { OfflineIndicator } from '../offline-indicator';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'offline.backOnline': 'You are back online',
        'offline.youAreOffline': 'You are offline',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Mock online status
let mockIsOnline = true;
vi.mock('@/app/hooks/use-online-status', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  mockIsOnline = true;
});

describe('OfflineIndicator', () => {
  it('renders nothing when online and showWhenOnline is false', () => {
    const { container } = render(<OfflineIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders online banner when showWhenOnline is true', () => {
    render(<OfflineIndicator showWhenOnline />);
    expect(screen.getByText('You are back online')).toBeInTheDocument();
  });

  it('renders offline banner when offline', () => {
    mockIsOnline = false;
    render(<OfflineIndicator />);
    expect(screen.getByText('You are offline')).toBeInTheDocument();
  });

  it('has role="status" for accessibility', () => {
    mockIsOnline = false;
    render(<OfflineIndicator />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-live="polite" for screen reader announcements', () => {
    mockIsOnline = false;
    render(<OfflineIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows pulse animation dot when offline', () => {
    mockIsOnline = false;
    const { container } = render(<OfflineIndicator />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('does not show pulse animation when online', () => {
    const { container } = render(<OfflineIndicator showWhenOnline />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeInTheDocument();
  });

  it('applies yellow background when offline', () => {
    mockIsOnline = false;
    render(<OfflineIndicator />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('bg-yellow-500');
  });

  it('applies green background when online', () => {
    render(<OfflineIndicator showWhenOnline />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('bg-green-500');
  });

  it('applies custom className', () => {
    mockIsOnline = false;
    render(<OfflineIndicator className="custom-class" />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('custom-class');
  });
});
