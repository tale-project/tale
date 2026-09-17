import { CliError, usageError } from './fail';

export interface PrivateInputMessages {
  /** A chunk that is neither text nor bytes. */
  invalid: string;
  oversized: string;
  unreadable: string;
  encoding: string;
}

/** Stream private input with a byte cap, before decoding or parsing secrets.
 * Refusals carry only the caller's fixed messages, never the input. */
export async function readPrivateText(
  source: AsyncIterable<unknown>,
  limit: number,
  messages: PrivateInputMessages,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const value of source) {
      if (typeof value !== 'string' && !Buffer.isBuffer(value))
        throw usageError(messages.invalid);
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      size += chunk.byteLength;
      if (size > limit) throw usageError(messages.oversized);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw usageError(messages.unreadable);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw usageError(messages.encoding);
  }
}
