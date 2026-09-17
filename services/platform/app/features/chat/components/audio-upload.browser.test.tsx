import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFileUpload } from '@/app/features/shared/files/use-file-upload';
import { render, screen } from '@/tests/utils/render';

import { Composer } from './composer';

import '@/app/globals.css';

const { presign, save, setup } = vi.hoisted(() => ({
  presign: vi
    .fn()
    .mockResolvedValue({ url: 'https://upload.invalid/file', method: 'POST' }),
  save: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: presign }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: save }),
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: () => ({
    policyEnabled: false,
    allowedTypes: [],
    allowedExtensions: [],
    blockedExtensions: [],
    maxFileSize: 100_000_000,
  }),
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function AudioUpload() {
  const upload = useFileUpload({
    organizationId: 'audio-test',
    transcriptionAvailable: false,
    transcriptionUnavailableReason: 'TRANSCRIPTION_MODEL_UNAVAILABLE',
  });
  return (
    <Composer
      draftKey="audio-preflight-browser"
      models={[]}
      selection={{}}
      onSelectionChange={vi.fn()}
      onSend={vi.fn()}
      attachments={upload.attachments}
      uploadingAttachments={upload.uploadingFiles}
      onAttachFiles={(files) => {
        void upload.uploadFiles(files);
      }}
      transcriptionAvailable={false}
      transcriptionUnavailableReason="TRANSCRIPTION_MODEL_UNAVAILABLE"
      transcriptionSetupAction={{
        label: 'Review transcription model',
        onClick: setup,
      }}
    />
  );
}

describe('audio upload capability in the browser', () => {
  it('explains an unavailable pin before selection and uploads only the non-media file', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ storageId: 'text-upload' }), {
        status: 200,
      }),
    );
    const { container, user } = render(<AudioUpload />);
    expect(
      screen.getByText(
        'The selected audio transcription model is unavailable.',
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Review transcription model' }),
    );
    expect(setup).toHaveBeenCalledOnce();
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new Error('Attachment picker missing');
    // Genuine media bytes, with an unhelpful browser MIME: detection must
    // reject this before presigning, while the text file remains usable.
    await user.upload(input, [
      new File([new Uint8Array([0x49, 0x44, 0x33, 0])], 'meeting.mp3', {
        type: '',
      }),
      new File(['Notes'], 'notes.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(presign).toHaveBeenCalledOnce();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.queryByText('meeting.mp3')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
  });
});
