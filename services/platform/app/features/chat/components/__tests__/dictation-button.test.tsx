import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { DictationButton } from '../dictation-button';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'dictation.start': 'Start dictation',
        'dictation.stop': 'Stop dictation',
        'dictation.permissionDenied': 'Microphone access denied',
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

vi.mock('../../hooks/use-speech-to-text', () => ({
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

let mockOnTranscriptRef: ((t: string) => void) | null = null;

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockIsListening = false;
  mockIsSupported = true;
  mockError = null;
  mockOnTranscriptRef = null;
});

describe('DictationButton', () => {
  describe('rendering', () => {
    it('renders microphone button when supported', () => {
      render(<DictationButton onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Start dictation')).toBeInTheDocument();
    });

    it('returns null when speech recognition is not supported', () => {
      mockIsSupported = false;
      const { container } = render(<DictationButton onTranscript={vi.fn()} />);
      expect(container.innerHTML).toBe('');
    });

    it('shows stop label when listening', () => {
      mockIsListening = true;
      render(<DictationButton onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Stop dictation')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('calls startListening on click when not listening', async () => {
      const { user } = render(<DictationButton onTranscript={vi.fn()} />);

      await user.click(screen.getByLabelText('Start dictation'));

      expect(mockStartListening).toHaveBeenCalled();
    });

    it('calls stopListening on click when listening', async () => {
      mockIsListening = true;
      const { user } = render(<DictationButton onTranscript={vi.fn()} />);

      await user.click(screen.getByLabelText('Stop dictation'));

      expect(mockStopListening).toHaveBeenCalled();
    });

    it('does not call startListening when disabled', async () => {
      const { user } = render(
        <DictationButton onTranscript={vi.fn()} disabled />,
      );

      const button = screen.getByLabelText('Start dictation');
      await user.click(button);

      expect(mockStartListening).not.toHaveBeenCalled();
    });

    it('forwards transcript to onTranscript prop', () => {
      const onTranscript = vi.fn();
      render(<DictationButton onTranscript={onTranscript} />);

      mockOnTranscriptRef?.('hello world');

      expect(onTranscript).toHaveBeenCalledWith('hello world');
    });
  });

  describe('aria-pressed', () => {
    it('sets aria-pressed to false when not listening', () => {
      render(<DictationButton onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Start dictation')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('sets aria-pressed to true when listening', () => {
      mockIsListening = true;
      render(<DictationButton onTranscript={vi.fn()} />);
      expect(screen.getByLabelText('Stop dictation')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<DictationButton onTranscript={vi.fn()} />);
      await checkAccessibility(container);
    });

    it('passes axe audit when disabled', async () => {
      const { container } = render(
        <DictationButton onTranscript={vi.fn()} disabled />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when listening', async () => {
      mockIsListening = true;
      const { container } = render(<DictationButton onTranscript={vi.fn()} />);
      await checkAccessibility(container);
    });
  });
});
