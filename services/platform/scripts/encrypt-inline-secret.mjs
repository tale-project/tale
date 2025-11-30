#!/usr/bin/env node
/**
 * Encrypt a plaintext secret to compact JWE using the same method as convex/lib/crypto/encrypt_string.ts
 * - Algorithm: JWE (dir + A256GCM)
 * - Key source: ENCRYPTION_SECRET (base64url 32 bytes) or ENCRYPTION_SECRET_HEX (64 hex chars)
 *
 * Usage:
 *   echo -n "PLAINTEXT" | node scripts/encrypt-inline-secret.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

// Load environment variables from .env and .env.local (local overrides base)
function parseEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    const out = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

(function loadEnv() {
  const root = process.cwd();
  const envBase = parseEnvFile(path.join(root, '.env'));
  const envLocal = parseEnvFile(path.join(root, '.env.local'));
  const merged = { ...envBase, ...envLocal };
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

import { CompactEncrypt } from 'jose';

function base64UrlToBuffer(input) {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  return Buffer.from(base64, 'base64');
}

function getSecretKey() {
  const b64 = process.env.ENCRYPTION_SECRET;
  const hex = process.env.ENCRYPTION_SECRET_HEX;
  const value = b64 ?? hex;
  if (!value) {
    console.error(
      'Missing ENCRYPTION_SECRET or ENCRYPTION_SECRET_HEX environment variable (32-byte key).',
    );
    process.exit(2);
  }
  const keyBuf = b64 ? base64UrlToBuffer(value) : Buffer.from(value, 'hex');
  if (keyBuf.length !== 32) {
    console.error(
      `Encryption secret must be 32 bytes. Got ${keyBuf.length} bytes from ${
        b64 ? 'ENCRYPTION_SECRET' : 'ENCRYPTION_SECRET_HEX'
      }`,
    );
    process.exit(3);
  }
  return new Uint8Array(keyBuf);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const data = Buffer.concat(chunks).toString('utf8');
  return data.trim();
}

async function main() {
  const plaintext = await readStdin();
  if (!plaintext) {
    console.error('No plaintext provided on stdin.');
    process.exit(1);
  }
  const secret = getSecretKey();
  const encoder = new TextEncoder();
  const jwe = await new CompactEncrypt(encoder.encode(plaintext))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(secret);
  // Output compact JWE to stdout only
  process.stdout.write(jwe);
}

main().catch((err) => {
  console.error('Encryption failed:', err?.message || err);
  process.exit(4);
});
