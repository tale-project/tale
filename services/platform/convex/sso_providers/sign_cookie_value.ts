/**
 * Sign a cookie value using HMAC-SHA256.
 * This replicates the signing logic from better-call/crypto
 * so we can sign session tokens in Convex actions.
 *
 * Format: encodeURIComponent(`${value}.${base64Signature}`)
 */
export async function signCookieValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();

  // Import the secret key for HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Sign the value
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(value));

  // Convert to base64
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  // Return in the same format as better-call
  return encodeURIComponent(`${value}.${base64Signature}`);
}
