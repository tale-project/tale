import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDevEnv } from './dev-env';

/**
 * Bun loads the repo-root `.env` before the pipeline reads `.env.dev`, and a
 * root `.env` copied from an older `.env.example` carries an empty
 * `ELEVENLABS_API_KEY=`. The loader once kept any key already in the
 * environment, so that empty line hid the real key and the doctor reported
 * it missing, with a fix (append it to `.env.dev`) that could not help.
 */
describe('loadDevEnv', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function devEnvFile(contents: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'docs-videos-dev-env-'));
    dirs.push(dir);
    const file = path.join(dir, '.env.dev');
    writeFileSync(file, contents);
    return file;
  }

  it('fills a key the root .env left empty', () => {
    const env: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: '' };
    loadDevEnv(devEnvFile('ELEVENLABS_API_KEY=from-dev-env\n'), env);
    expect(env.ELEVENLABS_API_KEY).toBe('from-dev-env');
  });

  it('keeps a non-empty environment value over the file', () => {
    const env: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: 'from-shell' };
    loadDevEnv(devEnvFile('ELEVENLABS_API_KEY=from-dev-env\n'), env);
    expect(env.ELEVENLABS_API_KEY).toBe('from-shell');
  });

  it('sets an absent key, and skips comments and lines without a key', () => {
    const env: NodeJS.ProcessEnv = {};
    loadDevEnv(
      devEnvFile('# comment\n\n=orphan\n  ELEVENLABS_API_KEY = spaced  \n'),
      env,
    );
    expect(env).toEqual({ ELEVENLABS_API_KEY: 'spaced' });
  });

  it('leaves the environment alone when the file is missing', () => {
    const env: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: '' };
    loadDevEnv(path.join(tmpdir(), 'no-such-dir-for-dev-env', '.env.dev'), env);
    expect(env).toEqual({ ELEVENLABS_API_KEY: '' });
  });
});
