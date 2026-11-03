import { describe, expect, it } from 'vitest';

import { ConfigError } from './config.ts';
import { StoreOpenError } from './db/store.ts';
import { explainStartupFailure } from './startup-failure.ts';

const CONFIG = { port: 3004, dataDir: '/srv/sm/data' };

function systemError(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code });
}

describe('explainStartupFailure', () => {
  it('says that the port is taken, and what to do about it', () => {
    const text = explainStartupFailure(
      systemError('EADDRINUSE', 'Failed to start server. Is port 3004 in use?'),
      CONFIG,
    );
    expect(text).toBe(
      'Port 3004 is already in use. Stop the program that uses it, or set PORT to another port.',
    );
  });

  it('says that the port may not be used by this user', () => {
    const error = Object.assign(systemError('EACCES'), { syscall: 'listen' });
    expect(explainStartupFailure(error, CONFIG)).toContain('Port 3004');
  });

  it.each(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'EEXIST', 'ENOENT'])(
    'names the data directory when the system says %s while it is made',
    (code) => {
      const error = Object.assign(systemError(code), {
        syscall: 'mkdir',
        path: '/srv/sm/data',
      });
      const text = explainStartupFailure(error, CONFIG);
      expect(text).toContain('/srv/sm/data');
      expect(text).toContain('SESSION_MANAGER_DATA_DIR');
    },
  );

  it('names the data directory when SQLite cannot open its database', () => {
    const text = explainStartupFailure(
      systemError('SQLITE_CANTOPEN', 'unable to open database file'),
      CONFIG,
    );
    expect(text).toContain('/srv/sm/data');
    expect(text).toContain('unable to open database file');
  });

  it('gives the message of a database the app must not touch', () => {
    const error = new StoreOpenError(
      '/srv/sm/data/manager.db',
      'foreign',
      'x is not a Session Manager database.',
    );
    expect(explainStartupFailure(error, CONFIG)).toBe(
      'x is not a Session Manager database.',
    );
  });

  it('gives the message of a setting that is wrong', () => {
    expect(
      explainStartupFailure(
        new ConfigError('PORT must be a port number'),
        CONFIG,
      ),
    ).toBe('PORT must be a port number');
  });

  it('knows nothing of what it does not know: the error is the program’s to throw', () => {
    expect(explainStartupFailure(new Error('a bug'), CONFIG)).toBeNull();
    expect(explainStartupFailure('text', CONFIG)).toBeNull();
  });
});
