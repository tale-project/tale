import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { Composer } from './composer';

vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: false,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

afterEach(cleanup);

describe('video URL entry in the real composer', () => {
  it('keeps a typed URL as text and passes a pasted URL to attachment ingestion', async () => {
    const ingest = vi.fn();
    const { user } = render(
      <Composer
        draftKey="video-link-browser-test"
        models={[]}
        selection={{}}
        onSelectionChange={vi.fn()}
        onSend={vi.fn()}
        onIngestVideoUrls={ingest}
        transcriptionAvailable={false}
        transcriptionUnavailableReason="NO_TRANSCRIPTION_MODEL"
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Message input' });
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXc';
    await user.type(field, url);
    expect(field).toHaveValue(url);
    expect(ingest).not.toHaveBeenCalled();
    await user.clear(field);
    await user.paste(url);
    expect(field).toHaveValue(url);
    expect(ingest).toHaveBeenCalledExactlyOnceWith(url);
  });
});
