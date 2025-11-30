/**
 * Base64 encoding helper for integration sandbox
 * (btoa is not available in Node.js VM)
 */

export function base64Encode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}
