import { describe, expect, test } from 'bun:test';

import {
  logCommand,
  renderLaunchdPlist,
  renderSystemdUnit,
  serviceKindFor,
  servicePath,
} from './service';

const spec = {
  binary: '/usr/local/lib/tale-sandbox/tale',
  configPath: '/var/lib/tale-sandbox/device.json',
  stateDir: '/var/lib/tale-sandbox',
};

describe('raw device service', () => {
  test("an isolated device is a system service, a shared one the user's", () => {
    expect(serviceKindFor('linux', 'isolated')).toBe('systemd-system');
    expect(serviceKindFor('linux', 'shared')).toBe('systemd-user');
    expect(serviceKindFor('darwin', 'isolated')).toBe('launchd-daemon');
    expect(serviceKindFor('darwin', 'shared')).toBe('launchd-agent');
  });

  test('the systemd unit leaves the sessions running across a restart', () => {
    const unit = renderSystemdUnit({ ...spec, kind: 'systemd-system' });
    expect(unit).toContain(
      'ExecStart=/usr/local/lib/tale-sandbox/tale sandbox device run --config /var/lib/tale-sandbox/device.json',
    );
    expect(unit).toContain('KillMode=process');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WantedBy=multi-user.target');
    expect(unit).toContain('After=network-online.target');
    const user = renderSystemdUnit({
      ...spec,
      kind: 'systemd-user',
      stateDir: '/home/a b/.tale/sandbox',
    });
    expect(user).toContain('WantedBy=default.target');
    expect(user).toContain(
      'Environment="TALE_SANDBOX_HOME=/home/a b/.tale/sandbox"',
    );
  });

  test('the launchd job keeps the process groups the device started', () => {
    const plist = renderLaunchdPlist({
      ...spec,
      kind: 'launchd-daemon',
      configPath: '/x/<&>.json',
    });
    expect(plist).toContain('<string>dev.tale.sandbox-device</string>');
    expect(plist).toContain('<key>AbandonProcessGroup</key>\n  <true/>');
    expect(plist).toContain('<string>/x/&lt;&amp;&gt;.json</string>');
    expect(plist).toContain(
      '<string>/var/lib/tale-sandbox/logs/device.log</string>',
    );
  });

  test('where each service lives and how its log is read', () => {
    expect(servicePath('systemd-system', '/root')).toBe(
      '/etc/systemd/system/tale-sandbox-device.service',
    );
    expect(servicePath('launchd-agent', '/Users/a')).toBe(
      '/Users/a/Library/LaunchAgents/dev.tale.sandbox-device.plist',
    );
    expect(servicePath('none', '/root')).toBeNull();
    expect(
      logCommand('systemd-user', '/s', { follow: true, tail: 20 }),
    ).toEqual([
      'journalctl',
      '--user',
      '-u',
      'tale-sandbox-device.service',
      '-n',
      '20',
      '--no-pager',
      '-f',
    ]);
    expect(
      logCommand('launchd-daemon', '/s', { follow: false, tail: 5 }),
    ).toEqual(['tail', '-n', '5', '/s/logs/device.log']);
  });
});
