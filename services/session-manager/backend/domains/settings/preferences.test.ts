import { describe, expect, it } from 'vitest';

import { DEFAULT_START_PAGE } from '../../lib/web-url.ts';
import {
  DEFAULT_PREFERENCES,
  MCP_ENABLED_KEY,
  START_PAGE_KEY,
  loadPreferences,
} from './preferences.ts';

describe('loadPreferences', () => {
  it('has the defaults when nothing is stored', () => {
    expect(loadPreferences({})).toEqual({
      startPage: DEFAULT_START_PAGE,
      mcpEnabled: false,
    });
    expect(DEFAULT_PREFERENCES).toEqual({
      startPage: 'https://www.google.com',
      mcpEnabled: false,
    });
  });

  it('keeps the stored values', () => {
    expect(
      loadPreferences({
        [START_PAGE_KEY]: 'https://example.org',
        [MCP_ENABLED_KEY]: true,
      }),
    ).toEqual({ startPage: 'https://example.org', mcpEnabled: true });
  });

  it('uses the stored start page as it is, without completing it again', () => {
    expect(
      loadPreferences({ [START_PAGE_KEY]: 'http://localhost:8080/start' })
        .startPage,
    ).toBe('http://localhost:8080/start');
  });

  it.each([
    ['not text', 42],
    ['null', null],
    ['empty', ''],
    ['not a web address', 'hello world'],
    ['another scheme', 'javascript:alert(1)'],
    ['a file', 'file:///etc/passwd'],
  ])('falls back to the default start page when it is %s', (_why, value) => {
    expect(loadPreferences({ [START_PAGE_KEY]: value }).startPage).toBe(
      DEFAULT_START_PAGE,
    );
  });

  it.each([
    ['the text "true"', 'true'],
    ['1', 1],
    ['null', null],
    ['false', false],
  ])('does not enable AI access for %s', (_why, value) => {
    expect(loadPreferences({ [MCP_ENABLED_KEY]: value }).mcpEnabled).toBe(
      false,
    );
  });

  it('ignores what it does not know', () => {
    expect(loadPreferences({ theme: 'dark' })).toEqual(DEFAULT_PREFERENCES);
  });
});
