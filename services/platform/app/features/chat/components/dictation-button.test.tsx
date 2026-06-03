import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import {
  DictationButton,
  type DictationButtonHandle,
} from './dictation-button';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'dictation.start': 'Start dictation',
        'dictation.stop': 'Stop dictation',
        'dictation.transcribing': 'Transcribing',
        'dictation.permissionDenied': 'Microphone access denied',
        'dictation.transcriptionFailedShort': 'Transcription failed',
        'dictation.retry': 'Try again',
        'dictation.discard': 'Discard recording',
        'dictation.notConfigured': 'Dictation unavailable',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Voice/transcription capability detection — default to "available" so the
// existing tests exercise the normal enabled paths; flip `mockHasTranscription`
// to drive the not-configured branch.
let mockHasTranscription = true;
vi.mock('../hooks/use-voice-capabilities', () => ({
  useVoiceCapabilities: () => ({
    hasTts: true,
    hasTranscription: mockHasTranscription,
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

const mockStartListening = vi.fn();
const mockStopListening = vi.fn();

let mockIsListening = false;
let mockIsSupported = true;
let mockError: string | null = null;

vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: (opts: { onTranscript: (t: string) => void }) => {
    mockOnTranscriptRef = opts.onTranscript;
    return {
      isListening: mockIsListening,
      isSupported: mockIsSupported,
      error: mockError,
      startListening: mockStartListening,
      stopListening: mockStopListening,
    };
  },
}));

// The MediaRecorder fallback hook is exercised in its own test; here we just
// stub it so DictationButton renders predictably while we test the Web Speech
// branch. `mockRecorderSupported` lets a test simulate a browser where
// neither path is available.
let mockRecorderSupported = false;
let mockRecorderIsTranscribing = false;
let mockRecorderHasFailedRecording = false;
const mockRecorderRetry = vi.fn();
const mockRecorderDiscard = vi.fn();

vi.mock('../hooks/use-media-recorder-dictation', () => ({
  useMediaRecorderDictation: () => ({
    isListening: false,
    isTranscribing: mockRecorderIsTranscribing,
    isSupported: mockRecorderSupported,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    hasFailedRecording: mockRecorderHasFailedRecording,
    retryTranscription: mockRecorderRetry,
    discardFailedRecording: mockRecorderDiscard,
  }),
}));

let mockOnTranscriptRef: ((t: string) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsListening = false;
  mockIsSupported = true;
  mockError = null;
  mockRecorderSupported = false;
  mockRecorderIsTranscribing = false;
  mockRecorderHasFailedRecording = false;
  mockHasTranscription = true;
  mockOnTranscriptRef = null;
});

const orgId = 'org_test';

describe('DictationButton', () => {
  describe('rendering', () => {
    it('renders microphone button when supported', () => {
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Start dictation')).toBeInTheDocument();
    });

    it('returns null when neither Web Speech nor MediaRecorder is available', () => {
      mockIsSupported = false;
      mockRecorderSupported = false;
      const { container } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders microphone button via MediaRecorder fallback when Web Speech is missing', () => {
      mockIsSupported = false;
      mockRecorderSupported = true;
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Start dictation')).toBeInTheDocument();
    });

    it('shows stop label when listening', () => {
      mockIsListening = true;
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Stop dictation')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('calls startListening on click when not listening', async () => {
      const { user } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );

      await user.click(screen.getByLabelText('Start dictation'));

      expect(mockStartListening).toHaveBeenCalled();
    });

    it('calls stopListening on click when listening', async () => {
      mockIsListening = true;
      const { user } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );

      await user.click(screen.getByLabelText('Stop dictation'));

      expect(mockStopListening).toHaveBeenCalled();
    });

    it('does not call startListening when disabled', async () => {
      const { user } = render(
        <DictationButton
          organizationId={orgId}
          onTranscript={vi.fn()}
          disabled
        />,
      );

      const button = screen.getByLabelText('Start dictation');
      await user.click(button);

      expect(mockStartListening).not.toHaveBeenCalled();
    });

    it('disables the mic with an explanation when the server fallback has no transcription model', async () => {
      // Force the MediaRecorder fallback (no Web Speech) with no configured
      // transcription provider.
      mockIsSupported = false;
      mockRecorderSupported = true;
      mockHasTranscription = false;
      const { user } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );

      const button = screen.getByLabelText('Dictation unavailable');
      expect(button).toHaveAttribute('aria-disabled', 'true');

      await user.click(button);
      expect(mockStartListening).not.toHaveBeenCalled();
    });

    it('stays enabled on the Web Speech path even without a transcription model', () => {
      // Web Speech needs no provider, so a missing transcription model must
      // not disable it.
      mockIsSupported = true;
      mockHasTranscription = false;
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      const button = screen.getByLabelText('Start dictation');
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('forwards transcript to onTranscript prop', () => {
      const onTranscript = vi.fn();
      render(
        <DictationButton organizationId={orgId} onTranscript={onTranscript} />,
      );

      mockOnTranscriptRef?.('hello world');

      expect(onTranscript).toHaveBeenCalledWith('hello world');
    });
  });

  // Regression test for #1462: sending a message must be able to stop an
  // active recording so the mic doesn't keep listening after send.
  describe('imperative stop() handle (#1462)', () => {
    it('stops an active recording when stop() is called', () => {
      mockIsListening = true;
      const ref = createRef<DictationButtonHandle>();
      render(
        <DictationButton
          ref={ref}
          organizationId={orgId}
          onTranscript={vi.fn()}
        />,
      );

      ref.current?.stop();

      expect(mockStopListening).toHaveBeenCalled();
    });

    it('is a no-op when not currently recording', () => {
      mockIsListening = false;
      const ref = createRef<DictationButtonHandle>();
      render(
        <DictationButton
          ref={ref}
          organizationId={orgId}
          onTranscript={vi.fn()}
        />,
      );

      ref.current?.stop();

      expect(mockStopListening).not.toHaveBeenCalled();
    });
  });

  describe('aria-pressed', () => {
    it('sets aria-pressed to false when not listening', () => {
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Start dictation')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('sets aria-pressed to true when listening', () => {
      mockIsListening = true;
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Stop dictation')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('failed-recording pill (MediaRecorder fallback)', () => {
    function renderFailed() {
      mockIsSupported = false;
      mockRecorderSupported = true;
      mockRecorderHasFailedRecording = true;
      return render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );
    }

    it('renders the failed pill with retry and discard when a recording failed', () => {
      renderFailed();
      expect(screen.getByText('Transcription failed')).toBeInTheDocument();
      expect(screen.getByLabelText('Try again')).toBeInTheDocument();
      expect(screen.getByLabelText('Discard recording')).toBeInTheDocument();
    });

    it('retry button calls retryTranscription', async () => {
      const { user } = renderFailed();
      await user.click(screen.getByLabelText('Try again'));
      expect(mockRecorderRetry).toHaveBeenCalledOnce();
    });

    it('discard button calls discardFailedRecording', async () => {
      const { user } = renderFailed();
      await user.click(screen.getByLabelText('Discard recording'));
      expect(mockRecorderDiscard).toHaveBeenCalledOnce();
    });

    it('does not render the pill on the Web Speech path', () => {
      // Web Speech supported → fallback inert → no pill even if the recorder
      // hook reports a (stale) failed recording.
      mockIsSupported = true;
      mockRecorderHasFailedRecording = true;
      render(<DictationButton organizationId={orgId} onTranscript={vi.fn()} />);
      expect(
        screen.queryByText('Transcription failed'),
      ).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when disabled', async () => {
      const { container } = render(
        <DictationButton
          organizationId={orgId}
          onTranscript={vi.fn()}
          disabled
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when listening', async () => {
      mockIsListening = true;
      const { container } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when transcribing via the MediaRecorder fallback', async () => {
      mockIsSupported = false;
      mockRecorderSupported = true;
      mockRecorderIsTranscribing = true;
      const { container } = render(
        <DictationButton organizationId={orgId} onTranscript={vi.fn()} />,
      );
      await checkAccessibility(container);
    });
  });
});
