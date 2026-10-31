import { describe, expect, test } from 'bun:test';

import {
  generateProjectId,
  invalidProjectIdMessage,
  isValidProjectId,
} from './generate-project-id';

describe('generateProjectId', () => {
  test.each([
    ['a digit-led folder', '2024-site', /^2024-site-[0-9a-f]{6}$/],
    [
      'a folder with spaces and marks',
      'My Project!!',
      /^my-project-[0-9a-f]{6}$/,
    ],
    ['a folder with runs of separators', '--a__b--', /^a-b-[0-9a-f]{6}$/],
    [
      'a folder without a Latin letter or digit',
      '日本語',
      /^tale-[0-9a-f]{6}$/,
    ],
    ['an empty name', '', /^tale-[0-9a-f]{6}$/],
    [
      'a long name cut at a hyphen',
      `${'a'.repeat(32)}-tail`,
      new RegExp(`^${'a'.repeat(32)}-[0-9a-f]{6}$`),
    ],
  ])('names %s', (_name, folder, expected) => {
    const id = generateProjectId(folder);
    expect(id).toMatch(expected);
    expect(isValidProjectId(id)).toBe(true);
  });

  test('keeps a long name within 40 characters', () => {
    const id = generateProjectId('x'.repeat(100));
    expect(id).toHaveLength(40);
    expect(isValidProjectId(id)).toBe(true);
  });
});

describe('isValidProjectId', () => {
  test.each(['2024-site-abc123', 'tale', '0', 'a'.repeat(40)])(
    'accepts %s',
    (id) => {
      expect(isValidProjectId(id)).toBe(true);
    },
  );

  test.each([
    '',
    'a'.repeat(41),
    'Tale',
    '-tale',
    'tale_dev',
    'tale.dev',
    'tale dev',
  ])('refuses "%s"', (id) => {
    expect(isValidProjectId(id)).toBe(false);
  });
});

test('the refusal of an invalid ID names the rule and the fix', () => {
  expect(invalidProjectIdMessage('2024_site')).toBe(
    'Project ID "2024_site" in tale.json is invalid: use 1 to 40 lowercase letters, digits and hyphens, starting with a letter or digit. Fix "id" in tale.json, or remove it and run "tale update" to assign a new one.',
  );
});
