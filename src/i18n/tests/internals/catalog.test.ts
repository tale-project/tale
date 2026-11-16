import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  catalogFiles,
  catalogTopics,
  listCatalogLocales,
  readCatalog,
} from './catalog';

let dir: string;

function write(file: string, text: string): void {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a single-file catalog', () => {
  it('reads as its tree, with one file and no topics', () => {
    write('en.yml', 'chat:\n  send: Send\nhome:\n  title: Home\n');

    expect(readCatalog(dir, 'en')).toEqual({
      chat: { send: 'Send' },
      home: { title: 'Home' },
    });
    expect(catalogFiles(dir, 'en')).toEqual([
      { path: path.join(dir, 'en.yml') },
    ]);
    expect(catalogTopics(dir, 'en')).toEqual([]);
  });
});

describe('a catalog split into topic files', () => {
  it('reads as the same tree, each file under its topic', () => {
    write('en/chat.yml', 'send: Send\n');
    write('en/home.yml', 'title: Home\n');

    expect(readCatalog(dir, 'en')).toEqual({
      chat: { send: 'Send' },
      home: { title: 'Home' },
    });
    expect(catalogTopics(dir, 'en')).toEqual(['chat', 'home']);
    expect(catalogFiles(dir, 'en')).toEqual([
      { path: path.join(dir, 'en/chat.yml'), topic: 'chat' },
      { path: path.join(dir, 'en/home.yml'), topic: 'home' },
    ]);
  });

  it('reads an empty topic file as an empty namespace', () => {
    write('de-CH/chat.yml', '');

    expect(readCatalog(dir, 'de-CH')).toEqual({ chat: {} });
  });
});

describe('listCatalogLocales', () => {
  it('lists files and topic directories alike, without the shared files', () => {
    write('en/chat.yml', 'send: Send\n');
    write('de.yml', 'chat:\n  send: Senden\n');
    write('global.yml', 'global:\n  brand: Tale\n');
    fs.mkdirSync(path.join(dir, 'empty'));

    expect(listCatalogLocales(dir, ['global.yml'])).toEqual(['de', 'en']);
  });

  it('answers nothing for a missing directory, and undefined for a missing catalog', () => {
    expect(listCatalogLocales(path.join(dir, 'none'), [])).toEqual([]);
    expect(readCatalog(dir, 'fr')).toBeUndefined();
  });
});
