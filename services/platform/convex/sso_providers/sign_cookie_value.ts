/**
 * Sign a cookie value using HMAC-SHA256.
 * This replicates the signing logic from better-call/crypto
 * so we can sign session tokens in Convex actions.
 *
 * Format: encodeURIComponent(`${value}.${base64urlSignature}`)
 */
export async function signCookieValue(value: string, secret: string): Promise<string> {
  const signedValue = await signValue(value, secret);
  return encodeURIComponent(signedValue);
}

/**
 * Sign a value using HMAC-SHA256 and return in format: `${value}.${base64urlSignature}`
 */
export async function signValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(value));

  const base64urlSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${value}.${base64urlSignature}`;
}

/**
 * Verify a signed value and return the original value if valid, null otherwise.
 */
export async function verifySignedValue(signedValue: string, secret: string): Promise<string | null> {
  const lastDotIndex = signedValue.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return null;
  }

  const value = signedValue.substring(0, lastDotIndex);
  const expectedSigned = await signValue(value, secret);

  if (signedValue === expectedSigned) {
    return value;
  }

  return null;
}
