import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createI18n } from './i18n';

let dir: string;

function write(file: string, text: string): string {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-i18n-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('createI18n', () => {
  it('reads a single-file catalog', () => {
    const { t } = createI18n(write('en.yml', 'chat:\n  send: Send\n'));

    expect(t('chat.send')).toBe('Send');
  });

  it('reads a directory of topic files, each one namespace, over the package catalogs', () => {
    write('en/chat.yml', 'send: Send message\n');
    write('en/home.yml', 'title: Home\n');
    const pkg = write(
      'ui/en.yml',
      'common:\n  save: Save\nchat:\n  send: Send\n',
    );

    const { t } = createI18n(`${path.join(dir, 'en')}/`, { packages: [pkg] });

    expect(t('chat.send')).toBe('Send message');
    expect(t('home.title')).toBe('Home');
    expect(t('common.save')).toBe('Save');
  });
});
