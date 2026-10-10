// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { productMotionArgs } from './options';

describe('native product motion capture options', () => {
  it('captures every full native locale by default without changing the docs default', () => {
    expect(productMotionArgs([]).locales).toEqual(['en', 'de', 'fr']);
    expect(productMotionArgs(['--locales', 'fr']).locales).toEqual(['fr']);
  });

  it('retains explicit isolation paths verbatim and supports targeted page refreshes', () => {
    const stateDir = '/notes/capture state $(literal)';
    const configDir = '/notes/native config';
    const args = productMotionArgs([
      '--',
      '--state-dir',
      stateDir,
      '--config-dir',
      configDir,
      '--skip-seed',
      '--only',
      'home,chat',
      '--locales',
      'de,fr',
    ]);
    expect(args).toMatchObject({
      stateDir,
      configDir,
      skipSeed: true,
      only: ['home', 'chat'],
      locales: ['de', 'fr'],
    });
  });

  it('rejects an unknown native page rather than silently refreshing the wrong clip', () => {
    expect(() => productMotionArgs(['--only', 'chat,chatty'])).toThrow(
      'Unknown product motion page(s): chatty',
    );
  });

  it('keeps regional fallback out of duplicate capture directories', () => {
    expect(() => productMotionArgs(['--locales', 'de-CH'])).toThrow(
      'Unsupported capture locale',
    );
  });
});
