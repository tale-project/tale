import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  type ConversationAttachmentCapInput,
  validateConversationAttachmentCaps,
} from './attachments';

function pdf(size: number, i = 0): ConversationAttachmentCapInput {
  return { fileName: `doc-${i}.pdf`, contentType: 'application/pdf', size };
}

describe('validateConversationAttachmentCaps (#2661)', () => {
  it('no-ops for undefined or empty input', () => {
    expect(() => validateConversationAttachmentCaps(undefined)).not.toThrow();
    expect(() => validateConversationAttachmentCaps([])).not.toThrow();
  });

  it('accepts an attachment set within every cap', () => {
    expect(() =>
      validateConversationAttachmentCaps([pdf(1024, 0), pdf(2048, 1)]),
    ).not.toThrow();
  });

  it('rejects an over-count attachment set (the bypass: 11 files)', () => {
    const attachments = Array.from({ length: 11 }, (_, i) => pdf(1024, i));
    expect(() => validateConversationAttachmentCaps(attachments)).toThrow(
      AppError,
    );
    try {
      validateConversationAttachmentCaps(attachments);
    } catch (error) {
      expect((error as AppError<{ code: string }>).data).toMatchObject({
        code: 'CONVERSATION_ATTACHMENTS_TOO_MANY',
      });
    }
  });

  it('rejects a single oversized file (the bypass: 5e8 bytes)', () => {
    const attachments = [pdf(5e8, 0)];
    expect(() => validateConversationAttachmentCaps(attachments)).toThrow(
      AppError,
    );
    try {
      validateConversationAttachmentCaps(attachments);
    } catch (error) {
      expect((error as AppError<{ code: string }>).data).toMatchObject({
        code: 'CONVERSATION_ATTACHMENT_TOO_LARGE',
      });
    }
  });

  it('rejects a total size over the combined cap even with each file individually under the per-file cap', () => {
    const ninetyMb = 90 * 1024 * 1024;
    const attachments = [pdf(ninetyMb, 0), pdf(ninetyMb, 1), pdf(ninetyMb, 2)];
    expect(() => validateConversationAttachmentCaps(attachments)).toThrow(
      AppError,
    );
    try {
      validateConversationAttachmentCaps(attachments);
    } catch (error) {
      expect((error as AppError<{ code: string }>).data).toMatchObject({
        code: 'CONVERSATION_ATTACHMENTS_TOTAL_SIZE_EXCEEDED',
      });
    }
  });

  it('rejects a disallowed MIME type', () => {
    const attachments: ConversationAttachmentCapInput[] = [
      {
        fileName: 'payload.exe',
        contentType: 'application/x-msdownload',
        size: 1024,
      },
    ];
    expect(() => validateConversationAttachmentCaps(attachments)).toThrow(
      AppError,
    );
    try {
      validateConversationAttachmentCaps(attachments);
    } catch (error) {
      expect((error as AppError<{ code: string }>).data).toMatchObject({
        code: 'CONVERSATION_ATTACHMENT_TYPE_INVALID',
      });
    }
  });
});
