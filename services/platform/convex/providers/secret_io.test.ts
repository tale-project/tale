// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EncryptedFileWithoutKeyError } from '../lib/sops';

vi.mock('../lib/sops', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/sops')>('../lib/sops');
  return {
    ...actual,
    decryptSecretsFile: vi.fn(),
  };
});

import { decryptSecretsFile } from '../lib/sops';
import {
  UndecryptableExistingSecretError,
  prepareMergedSecrets,
} from './secret_io';

const mockedDecrypt = vi.mocked(decryptSecretsFile);

beforeEach(() => {
  mockedDecrypt.mockReset();
});

describe('prepareMergedSecrets', () => {
  it('throws UndecryptableExistingSecretError when decrypt fails and no force', async () => {
    mockedDecrypt.mockRejectedValueOnce(
      new Error('Failed to decrypt secrets file /x.json: bad key'),
    );

    await expect(
      prepareMergedSecrets('/x.json', { apiKey: 'sk-new' }),
    ).rejects.toBeInstanceOf(UndecryptableExistingSecretError);
  });

  it('rethrows EncryptedFileWithoutKeyError when no force', async () => {
    mockedDecrypt.mockRejectedValueOnce(
      new EncryptedFileWithoutKeyError('/x.json'),
    );

    await expect(
      prepareMergedSecrets('/x.json', { apiKey: 'sk-new' }),
    ).rejects.toBeInstanceOf(EncryptedFileWithoutKeyError);
  });

  it('overwrites when force=true and decrypt fails', async () => {
    mockedDecrypt.mockRejectedValueOnce(new Error('bad sops key'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await prepareMergedSecrets(
      '/x.json',
      { apiKey: 'sk-new' },
      { force: true },
    );

    expect(result.forced).toBe(true);
    expect(result.existed).toBe(false);
    expect(JSON.parse(result.plaintext)).toEqual({ apiKey: 'sk-new' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('overwrites when force=true and existing file is encrypted-no-key', async () => {
    mockedDecrypt.mockRejectedValueOnce(
      new EncryptedFileWithoutKeyError('/x.json'),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await prepareMergedSecrets(
      '/x.json',
      { apiKey: 'sk-new' },
      { force: true },
    );

    expect(result.forced).toBe(true);
    expect(JSON.parse(result.plaintext)).toEqual({ apiKey: 'sk-new' });
  });

  it('treats ENOENT as fresh write and merges only incoming', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedDecrypt.mockRejectedValueOnce(enoent);

    const result = await prepareMergedSecrets('/x.json', {
      apiKey: 'sk-new',
      modelKeys: { 'gpt-4': 'sk-model' },
    });

    expect(result.existed).toBe(false);
    expect(result.forced).toBe(false);
    expect(JSON.parse(result.plaintext)).toEqual({
      apiKey: 'sk-new',
      modelKeys: { 'gpt-4': 'sk-model' },
    });
  });

  it('merges incoming over existing when read succeeds', async () => {
    mockedDecrypt.mockResolvedValueOnce({
      apiKey: 'sk-old',
      modelKeys: { 'gpt-4': 'sk-old-model', 'claude-3': 'sk-claude' },
    });

    const result = await prepareMergedSecrets('/x.json', {
      modelKeys: { 'gpt-4': 'sk-new-model', gemini: 'sk-gemini' },
    });

    expect(result.existed).toBe(true);
    expect(JSON.parse(result.plaintext)).toEqual({
      apiKey: 'sk-old',
      modelKeys: {
        'gpt-4': 'sk-new-model',
        'claude-3': 'sk-claude',
        gemini: 'sk-gemini',
      },
    });
  });

  it('treats empty-string modelKey value as deletion', async () => {
    mockedDecrypt.mockResolvedValueOnce({
      apiKey: 'sk-old',
      modelKeys: { 'gpt-4': 'sk-old-model' },
    });

    const result = await prepareMergedSecrets('/x.json', {
      modelKeys: { 'gpt-4': '' },
    });

    const parsed = JSON.parse(result.plaintext);
    expect(parsed.modelKeys).toBeUndefined();
  });

  it('throws when no apiKey is available even on fresh write', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedDecrypt.mockRejectedValueOnce(enoent);

    await expect(prepareMergedSecrets('/x.json', {})).rejects.toThrow(
      /API key is required/i,
    );
  });
});
