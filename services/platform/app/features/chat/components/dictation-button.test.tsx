import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { DictationButton } from './dictation-button';

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
      };
      return translations[key] ?? key;
    },
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

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockIsListening = false;
  mockIsSupported = true;
  mockError = null;
  mockRecorderSupported = false;
  mockRecorderIsTranscribing = false;
  mockRecorderHasFailedRecording = false;
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

    it('forwards transcript to onTranscript prop', () => {
      const onTranscript = vi.fn();
      render(
        <DictationButton organizationId={orgId} onTranscript={onTranscript} />,
      );

      mockOnTranscriptRef?.('hello world');

      expect(onTranscript).toHaveBeenCalledWith('hello world');
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
