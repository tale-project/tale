import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  DEFAULT_README_CONTENT,
  DEFAULT_README_RELPATH,
} from './default-readme';

describe('default/README.md scaffold content', () => {
  test('lands at the org-template root (outside every domain dir)', () => {
    expect(DEFAULT_README_RELPATH).toBe(join('default', 'README.md'));
  });

  test('explains the load-bearing facts about default/', () => {
    // The active-vs-catalog rule — the reason the README exists.
    expect(DEFAULT_README_CONTENT).toContain('autoInstall');
    expect(DEFAULT_README_CONTENT).toContain('catalog');
    // Hot-reload story.
    expect(DEFAULT_README_CONTENT).toContain('tale dev');
    // Machine-managed files the user must leave alone.
    expect(DEFAULT_README_CONTENT).toContain('*.secrets.json');
    expect(DEFAULT_README_CONTENT).toContain('.history/');
    // Where to learn more.
    expect(DEFAULT_README_CONTENT).toContain('https://docs.tale.dev');
  });
});
