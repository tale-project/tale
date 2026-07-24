// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const speechState = vi.hoisted(() => ({
  isListening: false,
  isSupported: true,
  error: null as string | null,
  startListening: vi.fn(),
  stopListening: vi.fn(),
}));

vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => speechState,
}));

// jsdom has no AudioContext / getUserMedia — the level meter and the tones
// are exercised by their own units, not through this component.
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('../utils/dictation-sounds', () => ({
  playDictationStartSound: vi.fn(),
  playDictationStopSound: vi.fn(),
}));

import { DictationButton } from './dictation-button';

afterEach(() => {
  speechState.isListening = false;
  speechState.isSupported = true;
  speechState.error = null;
  speechState.startListening.mockReset();
  speechState.stopListening.mockReset();
});

describe('DictationButton', () => {
  it('offers to start dictation and starts on click', async () => {
    const { user } = render(<DictationButton onTranscript={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Start dictation' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(speechState.startListening).toHaveBeenCalledTimes(1);
  });

  it('flips to stop with a live level meter while listening', async () => {
    speechState.isListening = true;
    const { user } = render(<DictationButton onTranscript={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Stop dictation' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('progressbar', { name: 'Microphone level' }),
    ).toBeInTheDocument();

    await user.click(button);
    expect(speechState.stopListening).toHaveBeenCalledTimes(1);
  });

  it('renders nothing where the Web Speech API is missing', () => {
    speechState.isSupported = false;
    render(<DictationButton onTranscript={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
