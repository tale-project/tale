import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, timestamp } from './logger.ts';

/** Capture what each console channel was called with. */
function spyConsole() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { log, warn, error };
}

const ENV_KEYS = ['NO_COLOR', 'FORCE_COLOR', 'DEBUG'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('createLogger — level gating', () => {
  it('an info logger suppresses debug but emits info/warn/error', () => {
    const c = spyConsole();
    const log = createLogger();
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(c.log).toHaveBeenCalledTimes(1); // info only (debug suppressed)
    expect(c.warn).toHaveBeenCalledTimes(1);
    expect(c.error).toHaveBeenCalledTimes(1);
  });

  it('level:debug emits debug', () => {
    const c = spyConsole();
    createLogger({ level: 'debug' }).debug('d');
    expect(c.log).toHaveBeenCalledTimes(1);
  });

  it('DEBUG env enables debug', () => {
    process.env.DEBUG = '1';
    const c = spyConsole();
    createLogger().debug('d');
    expect(c.log).toHaveBeenCalledTimes(1);
  });

  it('a per-logger debugEnvVar enables debug only when that var is set', () => {
    const c = spyConsole();
    createLogger({ debugEnvVar: 'TALE_X_DEBUG' }).debug('d');
    expect(c.log).not.toHaveBeenCalled();
    process.env.TALE_X_DEBUG = '1';
    createLogger({ debugEnvVar: 'TALE_X_DEBUG' }).debug('d');
    expect(c.log).toHaveBeenCalledTimes(1);
    delete process.env.TALE_X_DEBUG;
  });

  it('a warn logger suppresses info', () => {
    const c = spyConsole();
    const log = createLogger({ level: 'warn' });
    log.info('i');
    log.warn('w');
    expect(c.log).not.toHaveBeenCalled();
    expect(c.warn).toHaveBeenCalledTimes(1);
  });
});

describe('createLogger — formatting & routing', () => {
  it('routes error→console.error, warn→console.warn, else console.log', () => {
    const c = spyConsole();
    const log = createLogger();
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(c.log.mock.calls[0][0]).toContain('i');
    expect(c.warn.mock.calls[0][0]).toContain('w');
    expect(c.error.mock.calls[0][0]).toContain('e');
  });

  it('forwards rest args', () => {
    const c = spyConsole();
    const meta = { a: 1 };
    createLogger().info('hi', meta, 2);
    expect(c.log.mock.calls[0].slice(1)).toEqual([meta, 2]);
  });

  it('plain (non-pretty) output is just the prefixed message — no escapes', () => {
    const c = spyConsole();
    createLogger({ namespace: 'knowledge', pretty: false }).info('hello');
    expect(c.log.mock.calls[0][0]).toBe('[knowledge] hello');
    expect(c.log.mock.calls[0][0]).not.toContain('\x1b');
  });

  it('child extends the namespace', () => {
    const c = spyConsole();
    createLogger({ namespace: 'knowledge', pretty: false })
      .child('rag')
      .info('x');
    expect(c.log.mock.calls[0][0]).toBe('[knowledge:rag] x');
  });

  it('pretty output carries a timestamp and a level label', () => {
    process.env.FORCE_COLOR = '1';
    const c = spyConsole();
    createLogger({ pretty: true }).info('hi');
    const line = String(c.log.mock.calls[0][0]);
    expect(line).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    expect(line).toContain('INFO');
  });
});

describe('createLogger — color derives from the shared capability probe (de-dup)', () => {
  it('NO_COLOR strips color even with pretty forced (regression)', () => {
    process.env.NO_COLOR = '1';
    const c = spyConsole();
    createLogger({ pretty: true }).error('boom');
    expect(c.error.mock.calls[0][0]).not.toContain('\x1b');
  });

  it('FORCE_COLOR enables color in pretty mode', () => {
    process.env.FORCE_COLOR = '1';
    const c = spyConsole();
    createLogger({ pretty: true }).error('boom');
    expect(c.error.mock.calls[0][0]).toContain('\x1b');
  });

  it('NO_COLOR wins over FORCE_COLOR (precedence)', () => {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';
    const c = spyConsole();
    createLogger({ pretty: true }).error('boom');
    expect(c.error.mock.calls[0][0]).not.toContain('\x1b');
  });
});

describe('timestamp', () => {
  it('is HH:MM:SS', () => {
    expect(timestamp()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
