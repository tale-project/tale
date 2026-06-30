/**
 * OpenAI Chat Completions message-content helpers.
 *
 * The OpenAI wire format lets a message's `content` be either a plain string
 * or an array of typed parts (`text` + `image_url`) — the latter is the ONLY
 * way to send images, so vision requests always use it. These pure helpers
 * normalize that shape and convert it to AI SDK user-message content. Kept free
 * of Convex/Node imports so they can be unit-tested directly.
 */

export interface OpenAITextPart {
  type: 'text';
  text: string;
}

export interface OpenAIImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: string };
}

export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart;

export type OpenAIMessageContent = string | OpenAIContentPart[];

/** AI SDK user-message content part (text or image). */
export type AiUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string };

export function isContentPartArray(
  content: unknown,
): content is OpenAIContentPart[] {
  return Array.isArray(content);
}

function isTextPart(part: unknown): part is OpenAITextPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function imageUrlOf(part: unknown): string | null {
  if (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'image_url'
  ) {
    const url = (part as { image_url?: { url?: unknown } }).image_url?.url;
    if (typeof url === 'string' && url.length > 0) return url;
  }
  return null;
}

/** Collect the `image_url` URLs from a message's content, in order. */
export function imageUrlsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const urls: string[] = [];
  for (const part of content) {
    const url = imageUrlOf(part);
    if (url) urls.push(url);
  }
  return urls;
}

/** Concatenate the text parts of a message's content (newline-joined). */
export function extractText(content: OpenAIMessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter(isTextPart)
    .map((p) => p.text)
    .join('\n');
}

/**
 * Whether a user message's content is usable: a non-empty string, or an array
 * carrying at least one text or image part. This is what the request validator
 * should accept — the old `typeof content === 'string'` check rejected every
 * multimodal (image) request.
 */
export function hasUsableUserContent(content: unknown): boolean {
  if (typeof content === 'string') return content.length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((p) => isTextPart(p) || imageUrlOf(p) !== null);
}

/**
 * Build AI SDK user-message content from OpenAI content plus a (possibly
 * PII-sanitized) replacement for the text portion. Images are passed through as
 * AI SDK `image` parts (the URL string — a `data:` URL or an `http(s)` URL the
 * provider fetches). Returns a plain string when there are no image parts so
 * the text-only path stays unchanged.
 */
export function buildAiUserContent(
  content: OpenAIMessageContent,
  sanitizedText: string,
): string | AiUserContentPart[] {
  if (typeof content === 'string') return sanitizedText;

  const imageParts: AiUserContentPart[] = [];
  for (const part of content) {
    const url = imageUrlOf(part);
    if (url) imageParts.push({ type: 'image', image: url });
  }
  if (imageParts.length === 0) return sanitizedText;

  const parts: AiUserContentPart[] = [];
  if (sanitizedText.length > 0)
    parts.push({ type: 'text', text: sanitizedText });
  parts.push(...imageParts);
  return parts;
}
