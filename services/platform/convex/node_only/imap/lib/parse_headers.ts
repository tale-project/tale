'use node';

export default function parseHeaders(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const headersMap = headers as Map<string, unknown>;

  for (const [key, value] of headersMap.entries()) {
    result[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return result;
}
