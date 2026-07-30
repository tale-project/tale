// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

// The component's `useT` is mocked to a fixed EN map so the assertions stay
// independent of the catalog loader; values mirror `messages/en.yml`.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'dictation.start': 'Start dictation',
        'dictation.stop': 'Stop dictation',
        'dictation.level': 'Microphone level',
        'dictation.transcribing': 'Transcribing…',
        'dictation.permissionDenied': 'Microphone access denied',
        'dictation.notSupported': 'Speech recognition not supported',
        'dictation.notConfigured':
          'Dictation unavailable — ask an admin to add a transcription model',
        'dictation.transcriptionFailedShort': 'Transcription failed',
        'dictation.retry': 'Try again',
        'dictation.discard': 'Discard recording',
      };
      return translations[key] ?? key;
    },
  }),
}));

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

// The MediaRecorder fallback hook is exercised by its own unit
// (use-media-recorder-dictation.test.ts); here it is stubbed so the button's
// path selection and fallback chrome render predictably.
const recorderState = vi.hoisted(() => ({
  isListening: false,
  isTranscribing: false,
  isSupported: true,
  error: null as string | null,
  startListening: vi.fn(),
  stopListening: vi.fn(),
  hasFailedRecording: false,
  retryTranscription: vi.fn(),
  discardFailedRecording: vi.fn(),
}));

vi.mock('../hooks/use-media-recorder-dictation', () => ({
  useMediaRecorderDictation: () => recorderState,
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
  recorderState.isListening = false;
  recorderState.isTranscribing = false;
  recorderState.isSupported = true;
  recorderState.error = null;
  recorderState.hasFailedRecording = false;
  recorderState.startListening.mockReset();
  recorderState.stopListening.mockReset();
  recorderState.retryTranscription.mockReset();
  recorderState.discardFailedRecording.mockReset();
});

const ORG_ID = 'org_test';

/** Force the MediaRecorder fallback: no Web Speech, transcription served. */
function armFallback() {
  speechState.isSupported = false;
  recorderState.isSupported = true;
}

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

  it('renders nothing where the Web Speech API is missing and no fallback is possible', () => {
    speechState.isSupported = false;
    recorderState.isSupported = false;
    render(<DictationButton onTranscript={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the Web Speech mic even when no transcription model exists (no server round-trip needed)', () => {
    render(
      <DictationButton
        onTranscript={vi.fn()}
        organizationId={ORG_ID}
        transcriptionAvailable={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Start dictation' }),
    ).toBeInTheDocument();
  });

  describe('MediaRecorder fallback (Firefox — no Web Speech)', () => {
    it('renders the mic and records through the fallback when transcription is available', async () => {
      armFallback();
      const { user } = render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );

      const button = screen.getByRole('button', { name: 'Start dictation' });
      await user.click(button);

      expect(recorderState.startListening).toHaveBeenCalledTimes(1);
      expect(speechState.startListening).not.toHaveBeenCalled();
    });

    it('renders a disabled mic with the ask-an-admin explanation when no transcription model is configured', () => {
      // Confirmed-unavailable keeps a trace of the feature (the 0.3
      // treatment): hoverable, explains itself, records nothing.
      armFallback();
      render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable={false}
        />,
      );
      const mic = screen.getByRole('button', {
        name: 'Dictation unavailable — ask an admin to add a transcription model',
      });
      expect(mic).toHaveAttribute('aria-disabled', 'true');
    });

    it('renders no mic when availability is unknown (prop absent)', () => {
      armFallback();
      render(
        <DictationButton onTranscript={vi.fn()} organizationId={ORG_ID} />,
      );
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders no mic without an organization to transcribe against', () => {
      armFallback();
      render(<DictationButton onTranscript={vi.fn()} transcriptionAvailable />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows the aria-busy transcribing state during the post-stop round-trip', () => {
      armFallback();
      recorderState.isTranscribing = true;
      render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );

      const button = screen.getByRole('button', { name: 'Transcribing…' });
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toBeDisabled();
    });
  });

  describe('failed-recording pill (MediaRecorder fallback)', () => {
    function renderFailed() {
      armFallback();
      recorderState.hasFailedRecording = true;
      return render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );
    }

    it('renders the persistent pill with retry and discard when a recording failed', () => {
      renderFailed();
      expect(screen.getByText('Transcription failed')).toBeInTheDocument();
      expect(screen.getByLabelText('Try again')).toBeInTheDocument();
      expect(screen.getByLabelText('Discard recording')).toBeInTheDocument();
    });

    it('retry re-sends the retained recording', async () => {
      const { user } = renderFailed();
      await user.click(screen.getByLabelText('Try again'));
      expect(recorderState.retryTranscription).toHaveBeenCalledOnce();
    });

    it('discard drops the retained recording', async () => {
      const { user } = renderFailed();
      await user.click(screen.getByLabelText('Discard recording'));
      expect(recorderState.discardFailedRecording).toHaveBeenCalledOnce();
    });

    it('hides the pill while a retry round-trip is in flight', () => {
      armFallback();
      recorderState.hasFailedRecording = true;
      recorderState.isTranscribing = true;
      render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );
      expect(
        screen.queryByText('Transcription failed'),
      ).not.toBeInTheDocument();
    });

    it('never renders the pill on the Web Speech path', () => {
      // Web Speech supported → fallback inert → no pill even if the recorder
      // hook reports a (stale) failed recording.
      recorderState.hasFailedRecording = true;
      render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );
      expect(
        screen.queryByText('Transcription failed'),
      ).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit while transcribing via the fallback', async () => {
      armFallback();
      recorderState.isTranscribing = true;
      const { container } = render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with the failed-recording pill shown', async () => {
      armFallback();
      recorderState.hasFailedRecording = true;
      const { container } = render(
        <DictationButton
          onTranscript={vi.fn()}
          organizationId={ORG_ID}
          transcriptionAvailable
        />,
      );
      await checkAccessibility(container);
    });
  });
});
