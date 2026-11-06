// @vitest-environment jsdom
/**
 * A staged recording's chip when its transcription failed. A usage limit
 * refuses it with the server's English sentence; the chip says so in the
 * reader's language and points at where the limit's reset shows, while any
 * other failure keeps its stored reason on hover. A staged document the
 * assistant cannot read opens its reason for every way of reaching it. A
 * staged image larger than a model is shown says so before the send.
 */
import '@testing-library/jest-dom/vitest';
import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileTranscriptionInfo } from '@/app/features/chat/hooks/use-file-transcription-status';
import type { BlobRef } from '@/backend/core/lib/storage/blob_ref';
import { CHAT_IMAGE_MODEL_MAX_SIZE } from '@/lib/shared/file-types';
import { USAGE_LIMIT_REFUSAL_PREFIX } from '@/lib/shared/usage-limit';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen } from '@/tests/utils/render';

import { ComposerAttachments } from './composer-attachments';

vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a staged upload's ref, as the composer holds it
const REF = 's3:blobs/acme/memo' as BlobRef;

function renderChip(info: FileTranscriptionInfo) {
  return render(
    <ComposerAttachments
      attachments={[
        {
          fileId: REF,
          fileName: 'memo.m4a',
          fileType: 'audio/mp4',
          fileSize: 48_000,
        },
      ]}
      uploadingFiles={[]}
      onRemove={vi.fn()}
      onCancelUpload={vi.fn()}
      transcriptionStatuses={new Map([[REF, info]])}
      transcriptionAvailable
      onRetryTranscription={vi.fn()}
    />,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'chat' });

afterEach(async () => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('a staged recording whose transcription failed', () => {
  it('says a usage limit stopped it, in the reader’s language', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    await i18n.changeLanguage('de');
    const de = i18n.getFixedT('de', 'chat');
    const { container } = renderChip({
      status: 'failed',
      error: `${USAGE_LIMIT_REFUSAL_PREFIX} Your monthly cost limit resets on 1 November.`,
    });

    const label = screen.getByText(de('transcription.limitReached'));
    expect(label).toBeVisible();
    expect(label).toHaveAttribute(
      'title',
      de('transcription.limitReachedHint'),
    );
    expect(screen.queryByText(/Usage limit reached/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: de('transcription.retry') }),
    ).toBeVisible();
    await checkAccessibility(container);
  });

  it('keeps any other failure’s reason on hover', () => {
    renderChip({ status: 'failed', error: 'The audio could not be decoded.' });

    const label = screen.getByText(t('transcription.couldNotTranscribe'));
    expect(label).toHaveAttribute('title', 'The audio could not be decoded.');
  });
});

describe('a staged document the assistant cannot read', () => {
  it('opens its reason for the keyboard and a screen reader, not only on hover', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a staged upload's ref, as the composer holds it
    const doc = 's3:blobs/acme/keys' as BlobRef;
    const { user, container } = render(
      <ComposerAttachments
        attachments={[
          {
            fileId: doc,
            fileName: 'keys.txt',
            fileType: 'text/plain',
            fileSize: 512,
          },
        ]}
        uploadingFiles={[]}
        onRemove={vi.fn()}
        onCancelUpload={vi.fn()}
        indexingStatuses={
          new Map([
            [
              doc,
              {
                status: 'queued',
                textStatus: 'refused',
                textErrorCode: 'secret_detected',
              },
            ],
          ])
        }
      />,
    );

    await user.tab();
    const label = screen.getByRole('button', { name: t('documentRefused') });
    expect(label).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      i18n.t('documentRefusedSecret', { ns: 'chat', filename: 'keys.txt' }),
    );
    await checkAccessibility(container);
  });
});

describe('a staged image larger than a model is shown', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a staged upload's ref, as the composer holds it
  const big = 's3:blobs/acme/party' as BlobRef;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a staged upload's ref, as the composer holds it
  const small = 's3:blobs/acme/scan' as BlobRef;
  const attachments = [
    {
      fileId: big,
      fileName: 'party.gif',
      fileType: 'image/gif',
      fileSize: CHAT_IMAGE_MODEL_MAX_SIZE + 1,
    },
    {
      fileId: small,
      fileName: 'scan.jpg',
      fileType: 'image/jpeg',
      fileSize: CHAT_IMAGE_MODEL_MAX_SIZE,
    },
  ];

  it('names it before the send, in the reader’s language', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    await i18n.changeLanguage('de');
    const { container } = render(
      <ComposerAttachments
        attachments={attachments}
        uploadingFiles={[]}
        onRemove={vi.fn()}
        onCancelUpload={vi.fn()}
        modelImageMaxSize={CHAT_IMAGE_MODEL_MAX_SIZE}
      />,
    );

    expect(
      screen.getByText(
        i18n.getFixedT('de', 'chat')('imagesTooLargeForModel', {
          names: 'party.gif',
          count: 1,
          maxSize: 2,
        }),
      ),
    ).toBeVisible();
    expect(screen.queryByText(/scan\.jpg/)).not.toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('says nothing about an image that fits', () => {
    render(
      <ComposerAttachments
        attachments={attachments.slice(1)}
        uploadingFiles={[]}
        onRemove={vi.fn()}
        onCancelUpload={vi.fn()}
        modelImageMaxSize={CHAT_IMAGE_MODEL_MAX_SIZE}
      />,
    );

    expect(screen.queryByText(/2 MB/)).not.toBeInTheDocument();
  });

  it('leaves it to the warning of a model that sees no image at all', () => {
    render(
      <ComposerAttachments
        attachments={attachments}
        uploadingFiles={[]}
        onRemove={vi.fn()}
        onCancelUpload={vi.fn()}
        modelImageMaxSize={CHAT_IMAGE_MODEL_MAX_SIZE}
        visionWarning={t('modelCannotSeeImages')}
      />,
    );

    expect(screen.getByText(t('modelCannotSeeImages'))).toBeVisible();
    expect(screen.queryByText(/party\.gif/)).not.toBeInTheDocument();
  });

  it('says nothing where no model is shown the images (a sandbox agent)', () => {
    render(
      <ComposerAttachments
        attachments={attachments}
        uploadingFiles={[]}
        onRemove={vi.fn()}
        onCancelUpload={vi.fn()}
      />,
    );

    expect(screen.queryByText(/party\.gif/)).not.toBeInTheDocument();
  });
});
