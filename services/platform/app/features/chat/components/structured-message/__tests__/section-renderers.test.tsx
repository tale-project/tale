import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NextStepsSection } from '../section-renderers';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'structured.nextSteps': 'Suggested follow-ups',
      };
      return translations[key] ?? key;
    },
  }),
}));

const noop = () => {};

describe('NextStepsSection', () => {
  it('renders follow-up buttons from content', () => {
    render(
      <NextStepsSection content={'Option A\nOption B'} onSendFollowUp={noop} />,
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('returns null when no items and not streaming', () => {
    const { container } = render(
      <NextStepsSection content="" onSendFollowUp={noop} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows skeleton when streaming with no items yet', () => {
    render(<NextStepsSection content="" isStreaming onSendFollowUp={noop} />);
    expect(screen.getByText('Suggested follow-ups')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows skeleton after existing items when streaming', () => {
    render(
      <NextStepsSection
        content={'Option A\nOption B'}
        isStreaming
        onSendFollowUp={noop}
      />,
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides skeleton when not streaming', () => {
    render(
      <NextStepsSection content={'Option A\nOption B'} onSendFollowUp={noop} />,
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
