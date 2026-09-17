import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFileUpload } from '@/app/features/shared/files/use-file-upload';
import { render, screen } from '@/tests/utils/render';

import { Composer } from './composer';
import { TranscriptionAvailabilityNotice } from './transcription-availability-notice';

import '@/app/globals.css';

const { presign, save, setup, speechState } = vi.hoisted(() => ({
  presign: vi
    .fn()
    .mockResolvedValue({ url: 'https://upload.invalid/file', method: 'POST' }),
  save: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn(),
  speechState: {
    isListening: false,
    isSupported: false,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  },
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
  useSpeechToText: () => speechState,
}));
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  speechState.isSupported = false;
  localStorage.clear();
});

function AudioUpload() {
  const [reason, setReason] = useState<string | null>(null);
  const onUnavailable = (failure?: string) =>
    setReason(failure ?? 'NO_TRANSCRIPTION_MODEL');
  const upload = useFileUpload({
    organizationId: 'audio-test',
    transcriptionAvailable: false,
    transcriptionUnavailableReason: 'TRANSCRIPTION_MODEL_UNAVAILABLE',
    onTranscriptionUnavailable: onUnavailable,
  });
  return (
    <>
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
        organizationId="audio-test"
        onTranscriptionUnavailable={onUnavailable}
      />
      <TranscriptionAvailabilityNotice
        open={reason !== null}
        onOpenChange={(open) => {
          if (!open) setReason(null);
        }}
        reason={reason ?? undefined}
        setupAction={{
          label: 'Review transcription model',
          onClick: setup,
        }}
      />
    </>
  );
}

describe('audio upload capability in the browser', () => {
  it('opens recovery on keyboard dictation activation, restores focus on Escape, and can reopen', async () => {
    const capture = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
    const { user } = render(<AudioUpload />);
    const mic = await screen.findByRole('button', { name: 'Start dictation' });
    expect(screen.queryByRole('dialog')).toBeNull();
    mic.focus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('dialog', {
        name: 'The selected audio transcription model is unavailable.',
      }),
    ).toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mic).toHaveFocus());
    await user.click(mic);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();
  });

  it('uses browser speech without configuration guidance when server transcription is unavailable', async () => {
    speechState.isSupported = true;
    const { user } = render(<AudioUpload />);
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    expect(speechState.startListening).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.queryByText(/audio transcription model is unavailable/),
    ).toBeNull();
  });

  it('uploads ordinary files without prompting for an audio model', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ storageId: 'text-upload' }), {
        status: 200,
      }),
    );
    const { container, user } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new Error('Attachment picker missing');
    await user.upload(
      input,
      new File(['Notes'], 'notes.txt', { type: 'text/plain' }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.queryByText(/audio transcription model is unavailable/),
    ).toBeNull();
  });

  it('stays quiet until a media upload is refused, then offers setup while accepting ordinary files', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ storageId: 'text-upload' }), {
        status: 200,
      }),
    );
    const { container, user } = render(<AudioUpload />);
    expect(
      screen.queryByText(
        'The selected audio transcription model is unavailable.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(
      screen.getByRole('dialog', {
        name: 'The selected audio transcription model is unavailable.',
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Review transcription model' }),
    );
    expect(setup).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.queryByText('meeting.mp3')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
  });
});
