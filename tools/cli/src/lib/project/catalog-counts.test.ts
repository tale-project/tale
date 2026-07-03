import { describe, expect, test } from 'bun:test';

import { countAutoInstall, countTopLevelEntries } from './catalog-counts';

describe('countAutoInstall', () => {
  test('splits entries by metadata.autoInstall === true', () => {
    const files = new Map<string, string>([
      ['chat/assistant.json', '{"metadata":{"autoInstall":true}}'],
      ['chat/coder.json', '{"metadata":{"autoInstall":false}}'],
      ['workforce/designer.json', '{"metadata":{"labels":["Design"]}}'],
    ]);
    expect(countAutoInstall(files)).toEqual({ active: 1, catalog: 2 });
  });

  test('only an explicit boolean true counts as active', () => {
    const files = new Map<string, string>([
      ['a.json', '{"metadata":{"autoInstall":"true"}}'],
      ['b.json', '{"metadata":null}'],
      ['c.json', '{"autoInstall":true}'],
      ['d.json', '"just a string"'],
    ]);
    expect(countAutoInstall(files)).toEqual({ active: 0, catalog: 4 });
  });

  test('malformed JSON counts as catalog instead of throwing', () => {
    const files = new Map<string, string>([
      ['broken.json', '{not json'],
      ['ok.json', '{"metadata":{"autoInstall":true}}'],
    ]);
    expect(countAutoInstall(files)).toEqual({ active: 1, catalog: 1 });
  });

  test('empty map yields zero counts', () => {
    expect(countAutoInstall(new Map())).toEqual({ active: 0, catalog: 0 });
  });
});

describe('countTopLevelEntries', () => {
  test('counts one entry per top-level bundle dir, not per file', () => {
    const files = new Map<string, string>([
      ['github/config.json', ''],
      ['github/connector.ts', ''],
      ['github/icon.svg', ''],
      ['slack/config.json', ''],
    ]);
    expect(countTopLevelEntries(files)).toBe(2);
  });

  test('handles Windows-style separators from the embed step', () => {
    const files = new Map<string, string>([
      ['github\\config.json', ''],
      ['github\\icon.svg', ''],
      ['slack\\config.json', ''],
    ]);
    expect(countTopLevelEntries(files)).toBe(2);
  });

  test('a root-level file is its own entry', () => {
    const files = new Map<string, string>([
      ['openrouter.json', ''],
      ['github/config.json', ''],
    ]);
    expect(countTopLevelEntries(files)).toBe(2);
  });
});
