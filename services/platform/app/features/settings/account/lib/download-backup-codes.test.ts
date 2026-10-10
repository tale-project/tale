import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  backupCodesFileName,
  downloadBackupCodes,
} from './download-backup-codes';

let savedEnv: typeof window.__ENV__;
const createObjectURL = vi.fn((_blob: Blob) => 'blob:backup-codes');
const revokeObjectURL = vi.fn((_url: string) => {});

beforeEach(() => {
  savedEnv = window.__ENV__;
  // jsdom implements neither object-URL API.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  window.__ENV__ = savedEnv;
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('backupCodesFileName', () => {
  it.each([
    [{}, 'tale-platform-backup-codes.txt'],
    [{ TOTP_ENVIRONMENT: 'PR' }, 'tale-platform-backup-codes.txt'],
    [{ TOTP_ENVIRONMENT: 'TE' }, 'tale-platform-te-backup-codes.txt'],
    [
      { TOTP_CLIENT_NAME: 'Example plus' },
      'exampleplus-tale-platform-backup-codes.txt',
    ],
    [
      { TOTP_CLIENT_NAME: 'Example plus', TOTP_ENVIRONMENT: 'TE' },
      'exampleplus-tale-platform-te-backup-codes.txt',
    ],
    [
      { TOTP_CLIENT_NAME: 'Tale', TOTP_ENVIRONMENT: 'TE' },
      'tale-platform-te-backup-codes.txt',
    ],
  ])('names the file for %j %s', (env, fileName) => {
    window.__ENV__ = { BASE_PATH: '', ...env };
    expect(backupCodesFileName()).toBe(fileName);
  });
});

describe('downloadBackupCodes', () => {
  it('saves the codes one per line under the deployment name', async () => {
    window.__ENV__ = {
      BASE_PATH: '',
      TOTP_CLIENT_NAME: 'Example plus',
      TOTP_ENVIRONMENT: 'TE',
    };
    const clicked: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked.push({ download: this.download, href: this.href });
      },
    );

    downloadBackupCodes(['aaaa-1111', 'bbbb-2222']);

    expect(clicked).toEqual([
      {
        download: 'exampleplus-tale-platform-te-backup-codes.txt',
        href: 'blob:backup-codes',
      },
    ]);
    expect(await createObjectURL.mock.calls[0]?.[0].text()).toBe(
      'aaaa-1111\nbbbb-2222',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup-codes');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
