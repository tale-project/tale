// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveAgePublicKey,
  resolveAgeRecipients,
  resolveAgeSecretKeys,
} from './age_keygen';

// Two real bech32-valid age keypairs generated via age-keygen for fixtures.
// `deriveAgePublicKey` is called on each in tests so the values must be
// genuine — they're test-only, never used to encrypt real data.
const KEY_A =
  'AGE-SECRET-KEY-1VKQW2VY98HRPNDLDDW8VRGAZPCLS3G99ESK5XGEZ0E7WH6R2029QDWVXJP';
const KEY_B =
  'AGE-SECRET-KEY-15XQXE07N8VXHGKCC9F3ZP2E2V20GEPJH2MK9WXTQ87HZ72H90GLSH9ZYSS';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'age-keygen-test-'));
  vi.unstubAllEnvs();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('resolveAgeSecretKeys', () => {
  it('returns inline SOPS_AGE_KEY as a single-element array', () => {
    vi.stubEnv('SOPS_AGE_KEY', KEY_A);
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    expect(resolveAgeSecretKeys()).toEqual([KEY_A]);
  });

  it('returns [] when neither env var is set', () => {
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    expect(resolveAgeSecretKeys()).toEqual([]);
  });

  it('treats whitespace-only env values as unset', () => {
    vi.stubEnv('SOPS_AGE_KEY', '   ');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    expect(resolveAgeSecretKeys()).toEqual([]);
  });

  it('parses a single-key file', () => {
    const keyFile = path.join(dir, 'keys.txt');
    writeFileSync(keyFile, `${KEY_A}\n`);
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', keyFile);

    expect(resolveAgeSecretKeys()).toEqual([KEY_A]);
  });

  it('parses a multi-key file in source order', () => {
    const keyFile = path.join(dir, 'keys.txt');
    writeFileSync(keyFile, `${KEY_A}\n${KEY_B}\n`);
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', keyFile);

    expect(resolveAgeSecretKeys()).toEqual([KEY_A, KEY_B]);
  });

  it('skips comment and blank lines', () => {
    const keyFile = path.join(dir, 'keys.txt');
    writeFileSync(
      keyFile,
      `# rotation note\n\n${KEY_A}\n   \n# old key removed\n${KEY_B}\n`,
    );
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', keyFile);

    expect(resolveAgeSecretKeys()).toEqual([KEY_A, KEY_B]);
  });

  it('throws when SOPS_AGE_KEY_FILE points at a missing file', () => {
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', path.join(dir, 'nope.txt'));

    expect(() => resolveAgeSecretKeys()).toThrow(/SOPS_AGE_KEY_FILE/);
  });

  it('SOPS_AGE_KEY (inline) wins over SOPS_AGE_KEY_FILE when both are set', () => {
    const keyFile = path.join(dir, 'keys.txt');
    writeFileSync(keyFile, `${KEY_B}\n`);
    vi.stubEnv('SOPS_AGE_KEY', KEY_A);
    vi.stubEnv('SOPS_AGE_KEY_FILE', keyFile);

    expect(resolveAgeSecretKeys()).toEqual([KEY_A]);
  });
});

describe('resolveAgeRecipients', () => {
  it('returns one public recipient per configured secret key', () => {
    const keyFile = path.join(dir, 'keys.txt');
    writeFileSync(keyFile, `${KEY_A}\n${KEY_B}\n`);
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', keyFile);

    const recipients = resolveAgeRecipients();
    expect(recipients).toEqual([
      deriveAgePublicKey(KEY_A),
      deriveAgePublicKey(KEY_B),
    ]);
    expect(recipients[0].startsWith('age1')).toBe(true);
    expect(recipients[1].startsWith('age1')).toBe(true);
  });

  it('returns [] when no key is configured', () => {
    vi.stubEnv('SOPS_AGE_KEY', '');
    vi.stubEnv('SOPS_AGE_KEY_FILE', '');

    expect(resolveAgeRecipients()).toEqual([]);
  });
});
