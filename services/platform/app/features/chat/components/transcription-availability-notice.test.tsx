import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TranscriptionAvailabilityNotice } from './transcription-availability-notice';

describe('transcription availability recovery', () => {
  it('gives members a reason and administrator guidance', async () => {
    const { baseElement } = render(
      <TranscriptionAvailabilityNotice
        open
        onOpenChange={vi.fn()}
        reason="TRANSCRIPTION_MODEL_UNAVAILABLE"
      />,
    );
    expect(
      screen.getByText(/selected audio transcription model is unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Configure|Review/ }),
    ).toBeNull();
    await checkAccessibility(baseElement);
  });

  it('closes the recovery prompt before opening authorized settings', async () => {
    const configure = vi.fn();
    const close = vi.fn();
    const { user } = render(
      <TranscriptionAvailabilityNotice
        open
        onOpenChange={close}
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
    expect(close).toHaveBeenCalledWith(false);
  });

  it.each([
    'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE',
    'TRANSCRIPTION_MODEL_RESOLUTION_FAILED',
  ])(
    'offers a fresh check for %s without claiming missing setup',
    async (reason) => {
      const retry = vi.fn();
      const { user } = render(
        <TranscriptionAvailabilityNotice
          open
          onOpenChange={vi.fn()}
          reason={reason}
          onRetry={retry}
        />,
      );
      expect(
        screen.getByText(/availability could not be checked/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Ask an admin/)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledOnce();
    },
  );

  it('renders no warning or setup action while closed', () => {
    render(
      <TranscriptionAvailabilityNotice
        open={false}
        onOpenChange={vi.fn()}
        reason="NO_TRANSCRIPTION_MODEL"
        setupAction={{ label: 'Configure AI providers', onClick: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/No compatible model/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Configure AI providers' }),
    ).toBeNull();
  });
});
