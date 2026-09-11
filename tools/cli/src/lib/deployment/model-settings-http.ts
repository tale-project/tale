import { externalDepError } from '../../utils/fail';

export async function boundedResponse(
  response: Response,
  limit = 262144,
): Promise<unknown> {
  if (!response.body) throw externalDepError('Provider response has no body.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit)
      throw externalDepError(
        'Provider response exceeds its bounded metadata size.',
      );
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw externalDepError('Provider returned invalid JSON metadata.');
  }
}
