/**
 * Base64 decoding helper for integration sandbox
 * (atob is not available in Node.js VM)
 */

export function base64Decode(str: string): string {
  return Buffer.from(str, 'base64').toString('utf-8');
}
