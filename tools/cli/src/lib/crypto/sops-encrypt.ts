/**
 * Pure-JS SOPS-compatible JSON encryption using age (X25519).
 *
 * Produces JSON output that `sops -d` can decrypt, without requiring the
 * `sops` CLI binary at encryption time.  Uses the official `age-encryption`
 * library for age encryption and Node/Bun `crypto` for AES-GCM.
 */

import { Encrypter } from 'age-encryption';
import { randomBytes, createCipheriv, createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// age encryption (via official library)
// ---------------------------------------------------------------------------

/**
 * Encrypt a payload using age for a single X25519 recipient.
 * Returns the ASCII-armored age encrypted file string.
 */
async function ageEncrypt(
  payload: Buffer,
  agePublicKey: string,
): Promise<string> {
  const e = new Encrypter();
  e.addRecipient(agePublicKey);
  const encrypted = await e.encrypt(payload);

  // ASCII-armor the binary output
  const b64 = Buffer.from(encrypted).toString('base64');
  let armored = '-----BEGIN AGE ENCRYPTED FILE-----\n';
  for (let i = 0; i < b64.length; i += 64) {
    armored += b64.slice(i, i + 64) + '\n';
  }
  armored += '-----END AGE ENCRYPTED FILE-----\n';
  return armored;
}

// ---------------------------------------------------------------------------
// AES-256-GCM helpers
// ---------------------------------------------------------------------------

function aes256gcmEncrypt(
  plaintext: Buffer,
  key: Buffer,
  aad?: Buffer,
): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

// ---------------------------------------------------------------------------
// SOPS value encryption
// ---------------------------------------------------------------------------

function sopsEncryptValue(
  value: string,
  dataKey: Buffer,
  stableKey: string,
): string {
  const aad = Buffer.from(`${stableKey}:`, 'utf-8');
  const { ciphertext, iv, tag } = aes256gcmEncrypt(
    Buffer.from(value, 'utf-8'),
    dataKey,
    aad,
  );
  return (
    `ENC[AES256_GCM,` +
    `data:${ciphertext.toString('base64')},` +
    `iv:${iv.toString('base64')},` +
    `tag:${tag.toString('base64')},` +
    `type:str]`
  );
}

// ---------------------------------------------------------------------------
// SOPS MAC computation
// ---------------------------------------------------------------------------

function sopsComputeMac(
  encryptedValues: Record<string, string>,
  dataKey: Buffer,
): string {
  const sortedKeys = Object.keys(encryptedValues).sort();
  const hmac = createHmac('sha256', dataKey);
  for (const key of sortedKeys) {
    hmac.update(encryptedValues[key]);
  }
  const macPlaintext = hmac.digest();

  const { ciphertext, iv, tag } = aes256gcmEncrypt(macPlaintext, dataKey);
  return (
    `ENC[AES256_GCM,` +
    `data:${ciphertext.toString('base64')},` +
    `iv:${iv.toString('base64')},` +
    `tag:${tag.toString('base64')},` +
    `type:str]`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a flat JSON object into SOPS-compatible JSON using an age public key.
 *
 * @param plainObj  - flat key-value pairs (e.g. `{ apiKey: "sk-..." }`)
 * @param agePublicKey - age public key string ("age1...")
 * @returns  JSON string compatible with `sops -d`
 */
export async function sopsEncryptJson(
  plainObj: Record<string, string>,
  agePublicKey: string,
): Promise<string> {
  const dataKey = randomBytes(32);

  // Encrypt each value with AES-256-GCM
  const encryptedValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(plainObj)) {
    encryptedValues[key] = sopsEncryptValue(value, dataKey, key);
  }

  // Wrap data key using age encryption
  const ageEncryptedKey = await ageEncrypt(dataKey, agePublicKey);

  // Compute SOPS MAC
  const mac = sopsComputeMac(encryptedValues, dataKey);

  const result: Record<string, unknown> = {
    ...encryptedValues,
    sops: {
      kms: null,
      gcp_kms: null,
      azure_kv: null,
      hc_vault: null,
      age: [
        {
          recipient: agePublicKey,
          enc: ageEncryptedKey,
        },
      ],
      lastmodified: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      mac,
      pgp: null,
      unencrypted_suffix: '_unencrypted',
      version: '3.9.4',
    },
  };

  return JSON.stringify(result, null, '\t') + '\n';
}
