import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseCaptureArgs,
  screenshotFile,
  screenshotStateDir,
} from './capture-options';

describe('screenshot capture options', () => {
  it('preserves English docs paths and default local state', () => {
    const args = parseCaptureArgs([]);
    expect(args.locales).toEqual(['en']);
    expect(screenshotFile('platform', 'home-inbox', 'en')).toBe(
      'images/platform/home-inbox.webp',
    );
    expect(screenshotStateDir(args, undefined, '/capture/.state')).toBe(
      '/capture/.state',
    );
  });

  it('selects all three locales without duplicate captures', () => {
    const args = parseCaptureArgs([
      '--locales',
      'en,de,fr,de',
      '--only',
      'home-inbox,chat-thread-reply',
    ]);
    expect(args.locales).toEqual(['en', 'de', 'fr']);
    expect(args.only).toEqual(['home-inbox', 'chat-thread-reply']);
    expect(screenshotFile('platform', 'home-inbox', 'de')).toBe(
      'images/platform/de/home-inbox.webp',
    );
    expect(screenshotFile('platform', 'home-inbox', 'fr')).toBe(
      'images/platform/fr/home-inbox.webp',
    );
  });

  it('keeps isolated CLI state ahead of environment state', () => {
    const args = parseCaptureArgs(['--state-dir', 'private-capture-state']);
    expect(screenshotStateDir(args, '/other/session', '/capture/.state')).toBe(
      path.resolve('private-capture-state'),
    );
    expect(
      screenshotStateDir(
        parseCaptureArgs([]),
        '/other/session',
        '/capture/.state',
      ),
    ).toBe('/other/session');
  });

  it('passes an explicitly selected config root without reading deployment environment', () => {
    expect(parseCaptureArgs([]).configDir).toBeNull();
    expect(
      parseCaptureArgs(['--config-dir', '/isolated/platform/config']).configDir,
    ).toBe('/isolated/platform/config');
  });

  it.each(['--locales', '--only', '--grep', '--state-dir', '--config-dir'])(
    'rejects a missing %s value before opening a browser',
    (flag) => {
      expect(() => parseCaptureArgs([flag])).toThrow(
        `Missing value for ${flag}`,
      );
      expect(() => parseCaptureArgs([flag, '--skip-seed'])).toThrow(
        `Missing value for ${flag}`,
      );
    },
  );

  it.each(['en,de-CH', '', 'en,', 'es'])(
    'rejects unsupported locale list %j',
    (locales) => {
      expect(() => parseCaptureArgs(['--locales', locales])).toThrow();
    },
  );
});
