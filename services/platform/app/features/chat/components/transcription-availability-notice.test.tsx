import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TranscriptionAvailabilityNotice } from './transcription-availability-notice';

describe('transcription availability recovery', () => {
  it('gives members a reason and administrator guidance', async () => {
    const { container } = render(
      <TranscriptionAvailabilityNotice reason="TRANSCRIPTION_MODEL_UNAVAILABLE" />,
    );
    expect(
      screen.getByText(/selected audio transcription model is unavailable/),
    ).toHaveTextContent('Ask an admin');
    expect(screen.queryByRole('button')).toBeNull();
    await checkAccessibility(container);
  });

  it('offers the authorized setup action before choosing an audio file', async () => {
    const configure = vi.fn();
    const { user } = render(
      <TranscriptionAvailabilityNotice
        reason="NO_TRANSCRIPTION_MODEL"
        setupAction={{ label: 'Configure AI providers', onClick: configure }}
      />,
    );
    expect(screen.getByText(/No compatible model/)).not.toHaveTextContent(
      'Ask an admin',
    );
    await user.click(
      screen.getByRole('button', { name: 'Configure AI providers' }),
    );
    expect(configure).toHaveBeenCalledOnce();
  });

  it.each([
    'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE',
    'TRANSCRIPTION_MODEL_RESOLUTION_FAILED',
  ])(
    'offers a fresh check for %s without claiming missing setup',
    async (reason) => {
      const retry = vi.fn();
      const { user } = render(
        <TranscriptionAvailabilityNotice reason={reason} onRetry={retry} />,
      );
      expect(
        screen.getByText(/availability could not be checked/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Ask an admin/)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledOnce();
    },
  );
});
