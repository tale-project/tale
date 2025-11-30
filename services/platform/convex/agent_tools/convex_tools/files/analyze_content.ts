import { base64ToBytes } from '../../../lib/crypto/base64_to_bytes';

export type ParsedContentFormat =
  | 'text'
  | 'markdown'
  | 'html'
  | 'json'
  | 'image';

export type AnalyzeContentResult = {
  parsedText?: string;
  parsedFormat?: ParsedContentFormat;
  parsedTruncated?: boolean;
};

/**
 * analyzeContent
 *
 * Best-effort content analysis helper for file-like data.
 *
 * - For text / markdown / HTML / JSON / XML: returns UTF-8 decoded text.
 * - For Office-like docs: does a simple best-effort ASCII extraction.
 * - For images: does NOT generate a signed URL (to work in local setups), but
 *   returns a short textual description so the caller knows to use dataBase64
 *   + contentType with a vision-capable model.
 *
 * This helper intentionally does not attempt to interpret PDF binaries.
 */
export function analyzeContent(input: {
  fileName: string;
  contentType: string;
  size: number;
  dataBase64: string;
}): AnalyzeContentResult {
  let parsedText: string | undefined;
  let parsedFormat: ParsedContentFormat | undefined;
  let parsedTruncated = false;

  const contentType = (input.contentType || '').toLowerCase();
  const MAX_PARSED_CHARS = 100_000; // avoid huge tool responses

  const decodeUtf8 = (base64: string): string | undefined => {
    try {
      const bytes = base64ToBytes(base64);
      const decoder = new TextDecoder('utf-8', { fatal: false });
      return decoder.decode(bytes);
    } catch (error) {
      console.error('[tool:analyze_content] failed to decode base64 as UTF-8', {
        fileName: input.fileName,
        contentType: input.contentType,
        error:
          error instanceof Error ? error.message : String(error ?? 'unknown'),
      });
      return undefined;
    }
  };

  const stripHtmlTags = (html: string): string => {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const applyTruncation = (text: string): string => {
    if (text.length <= MAX_PARSED_CHARS) return text;
    parsedTruncated = true;
    return text.slice(0, MAX_PARSED_CHARS);
  };

  // ---------------------------------------------------------------------------
  // Text-like formats (text/*, JSON, XML)
  // ---------------------------------------------------------------------------

  if (contentType.startsWith('text/')) {
    const decoded = decodeUtf8(input.dataBase64);
    if (decoded != null) {
      if (contentType === 'text/html') {
        parsedText = applyTruncation(stripHtmlTags(decoded));
        parsedFormat = 'text';
      } else if (contentType === 'text/markdown') {
        parsedText = applyTruncation(decoded);
        parsedFormat = 'markdown';
      } else {
        parsedText = applyTruncation(decoded);
        parsedFormat = 'text';
      }
    }
  } else if (
    contentType === 'application/json' ||
    contentType.endsWith('+json')
  ) {
    const decoded = decodeUtf8(input.dataBase64);
    if (decoded != null) {
      try {
        const parsed = JSON.parse(decoded) as unknown;
        const pretty = JSON.stringify(parsed, null, 2);
        parsedText = applyTruncation(pretty);
        parsedFormat = 'json';
      } catch {
        parsedText = applyTruncation(decoded);
        parsedFormat = 'text';
      }
    }
  } else if (
    contentType === 'application/xml' ||
    contentType === 'text/xml' ||
    contentType.endsWith('+xml')
  ) {
    const decoded = decodeUtf8(input.dataBase64);
    if (decoded != null) {
      parsedText = applyTruncation(decoded);
      parsedFormat = 'text';
    }
  }

  // ---------------------------------------------------------------------------
  // Office-like docs (best-effort text extraction)
  // ---------------------------------------------------------------------------

  if (!parsedText) {
    const isWordLike =
      contentType.includes('word') ||
      contentType.includes('officedocument.wordprocessingml') ||
      contentType === 'application/msword';

    if (isWordLike) {
      const decoded = decodeUtf8(input.dataBase64);
      if (decoded != null) {
        // Strip non-printable characters to keep only readable text fragments
        const asciiOnly = decoded
          .replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (asciiOnly) {
          parsedText = applyTruncation(asciiOnly);
          parsedFormat = 'text';
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Images: no signed URL (works locally); tell caller to use base64 + contentType
  // ---------------------------------------------------------------------------

  if (!parsedText && contentType.startsWith('image/')) {
    parsedText =
      `Image file: ${input.fileName} (${contentType}, ${input.size} bytes). ` +
      'Use dataBase64 and contentType with a vision-capable model to inspect the image.';
    parsedFormat = 'image';
  }

  return {
    parsedText,
    parsedFormat,
    parsedTruncated,
  };
}
