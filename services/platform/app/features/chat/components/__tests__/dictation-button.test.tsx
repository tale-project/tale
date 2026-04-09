import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DictationButton } from '../dictation-button';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'dictation.start': 'Start dictation',
        'dictation.stop': 'Stop dictation',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('../../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: true,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

describe('DictationButton', () => {
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
  });
});
