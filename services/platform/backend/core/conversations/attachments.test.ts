import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  type ConversationAttachmentCapInput,
  validateConversationAttachmentCaps,
} from './attachments';

function pdf(size: number, i = 0): ConversationAttachmentCapInput {
  return { fileName: `doc-${i}.pdf`, contentType: 'application/pdf', size };
}

/** The code a set of attachments is refused with, or undefined when taken. */
function refusalCode(
  attachments: ConversationAttachmentCapInput[],
): string | undefined {
  try {
    validateConversationAttachmentCaps(attachments);
  } catch (error) {
    return (error as AppError<{ code: string }>).data.code;
  }
  return undefined;
}

describe('validateConversationAttachmentCaps (#2661) [CONV-R11]', () => {
  // The numbers the spec states, each at its edge: the last value taken and
  // the first one refused.
  it('holds one email to 10 files, 100 MB a file and 200 MB in all', () => {
    const MB = 1024 * 1024;
    const tenFiles = Array.from({ length: 10 }, (_, i) => pdf(1024, i));
    expect(refusalCode(tenFiles)).toBeUndefined();
    expect(refusalCode([...tenFiles, pdf(1024, 10)])).toBe(
      'CONVERSATION_ATTACHMENTS_TOO_MANY',
    );

    expect(refusalCode([pdf(100 * MB)])).toBeUndefined();
    expect(refusalCode([pdf(100 * MB + 1)])).toBe(
      'CONVERSATION_ATTACHMENT_TOO_LARGE',
    );

    const twoHundred = [pdf(100 * MB, 0), pdf(100 * MB, 1)];
    expect(refusalCode(twoHundred)).toBeUndefined();
    expect(refusalCode([...twoHundred, pdf(1, 2)])).toBe(
      'CONVERSATION_ATTACHMENTS_TOTAL_SIZE_EXCEEDED',
    );

    // A recording is held to the total alone, not to 100 MB.
    const recording = (size: number): ConversationAttachmentCapInput => ({
      fileName: 'call.mp3',
      contentType: 'audio/mpeg',
      size,
    });
    expect(refusalCode([recording(200 * MB)])).toBeUndefined();
    expect(refusalCode([recording(200 * MB + 1)])).toBe(
      'CONVERSATION_ATTACHMENTS_TOTAL_SIZE_EXCEEDED',
    );
  });

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
