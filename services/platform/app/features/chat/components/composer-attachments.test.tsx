// @vitest-environment jsdom
/**
 * A staged recording's chip when its transcription failed. A usage limit
 * refuses it with the server's English sentence; the chip says so in the
 * reader's language and points at where the limit's reset shows, while any
 * other failure keeps its stored reason on hover.
 */
import '@testing-library/jest-dom/vitest';
import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileTranscriptionInfo } from '@/app/features/chat/hooks/use-file-transcription-status';
import type { BlobRef } from '@/backend/core/lib/storage/blob_ref';
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
