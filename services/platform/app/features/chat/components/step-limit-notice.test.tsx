// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { StepLimitNotice, stepLimitHit } from './step-limit-notice';

describe('stepLimitHit', () => {
  it('reads the stamp structurally and defaults to false', () => {
    expect(stepLimitHit({ stepLimitHit: true })).toBe(true);
    expect(stepLimitHit({ stepLimitHit: false })).toBe(false);
    expect(stepLimitHit({ outputTokens: 12 })).toBe(false);
    expect(stepLimitHit(undefined)).toBe(false);
  });
});

describe('StepLimitNotice', () => {
  it('renders the neutral stopped-at-limit line', () => {
    render(<StepLimitNotice />);

    expect(
      screen.getByText(
        'Stopped here — this turn reached its step limit. Send a message to continue.',
      ),
    ).toBeInTheDocument();
  });
});
