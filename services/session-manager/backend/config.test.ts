import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allowedHostsFor, dbPath, loadConfig, profilesDir } from './config.ts';

describe('allowedHostsFor', () => {
  it('lets the loopback names address the app on its port', () => {
    expect([...allowedHostsFor('127.0.0.1', 3004)].sort()).toEqual([
      '127.0.0.1:3004',
      'localhost:3004',
    ]);
  });

  it('adds the address the app is bound to, written the way a Host header spells it', () => {
    expect(allowedHostsFor('192.168.1.5', 3004).has('192.168.1.5:3004')).toBe(
      true,
    );
    expect(allowedHostsFor('::1', 3004).has('[::1]:3004')).toBe(true);
  });

  it.each(['0.0.0.0', '::'])(
    'does not accept the wildcard address %s as a name for the app',
    (wildcard) => {
      // Nobody opens the app as http://0.0.0.0:3004; a page of another
      // website can send such a request (browsers send 0.0.0.0 to this
      // computer), and a name that is nobody's must not be let through.
      expect([...allowedHostsFor(wildcard, 8080)].sort()).toEqual([
        '127.0.0.1:8080',
        'localhost:8080',
      ]);
    },
  );

  it("adds the operator's own values, trimmed and lower-cased", () => {
    const hosts = allowedHostsFor('127.0.0.1', 3004, [
      ' Example.COM:8080 ',
      'localhost:9000',
    ]);
    expect(hosts.has('example.com:8080')).toBe(true);
    expect(hosts.has('localhost:9000')).toBe(true);
  });
});

describe('loadConfig', () => {
  it('answers the defaults of a local run for an empty environment', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 3004,
      dataDir: resolve('data'),
      blockWebrtc: false,
      camoufoxInstallDir: resolve('data', 'camoufox'),
      version: 'dev',
    });
    expect([...config.allowedHosts].sort()).toEqual([
      '127.0.0.1:3004',
      'localhost:3004',
    ]);
  });

  it('reads every setting from the environment', () => {
    const config = loadConfig({
      PORT: '8080',
      SESSION_MANAGER_HOST: ' 0.0.0.0 ',
      SESSION_MANAGER_DATA_DIR: '/srv/sm',
      SESSION_MANAGER_BLOCK_WEBRTC: 'Yes',
      SESSION_MANAGER_ALLOWED_HOSTS: 'localhost:80, ,Example.com:8080',
      CAMOUFOX_INSTALL_DIR: '/opt/camoufox',
      TALE_VERSION: '1.2.3',
    });
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
      dataDir: '/srv/sm',
      blockWebrtc: true,
      camoufoxInstallDir: '/opt/camoufox',
      version: '1.2.3',
    });
    expect([...config.allowedHosts].sort()).toEqual([
      '127.0.0.1:8080',
      'example.com:8080',
      'localhost:80',
      'localhost:8080',
    ]);
  });

  it.each(['1', 'true', 'yes', 'on', 'TRUE', ' On '])(
    'reads %j as switched on',
    (value) => {
      expect(
        loadConfig({ SESSION_MANAGER_BLOCK_WEBRTC: value }).blockWebrtc,
      ).toBe(true);
    },
  );

  it.each(['', '0', 'false', 'no', 'off', 'maybe'])(
    'reads %j as switched off',
    (value) => {
      expect(
        loadConfig({ SESSION_MANAGER_BLOCK_WEBRTC: value }).blockWebrtc,
      ).toBe(false);
    },
  );

  it('has no shutdown handshake unless a marker file is named', () => {
    expect(loadConfig({}).shutdownMarkerPath).toBeUndefined();
    expect(
      loadConfig({ SHUTDOWN_MARKER_PATH: '  ' }).shutdownMarkerPath,
    ).toBeUndefined();
  });

  it('names the marker file a supervisor drains traffic with', () => {
    expect(
      loadConfig({ SHUTDOWN_MARKER_PATH: ' /run/draining ' })
        .shutdownMarkerPath,
    ).toBe('/run/draining');
  });

  it.each(['abc', '-1', '65536', '3000.5'])('refuses %j as a port', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(
      `PORT must be a port number, got "${port}"`,
    );
  });

  it('keeps the browser inside the data directory unless told otherwise', () => {
    expect(
      loadConfig({ SESSION_MANAGER_DATA_DIR: '/srv/sm' }).camoufoxInstallDir,
    ).toBe('/srv/sm/camoufox');
  });

  it('takes the built page from a directory it is given', () => {
    expect(loadConfig({}, { distDir: '/tmp/dist' }).distDir).toBe('/tmp/dist');
  });
});

describe('where the data lives', () => {
  it('keeps the database and the profiles in the data directory', () => {
    const config = { dataDir: '/srv/sm' };
    expect(dbPath(config)).toBe(join('/srv/sm', 'manager.db'));
    expect(profilesDir(config)).toBe(join('/srv/sm', 'profiles'));
  });
});
