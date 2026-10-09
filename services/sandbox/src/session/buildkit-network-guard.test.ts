import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildkitdNetworkName } from '../buildkitd.ts';
import {
  attachBuildkitNetwork,
  parseForwardRules,
  readBuildkitNetworkPlan,
} from './buildkit-network-guard.ts';

const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
function done(value = '', observation = '') {
  writeFileSync(path, JSON.stringify(s));
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  console.log(observation && s.truncated === observation ? text.padEnd(2 * 1024 * 1024, '\n') : text);
  process.exit(0);
}
function fail() { console.error('fixture refusal'); process.exit(1); }
if (a[0] === 'inspect') done(s.session, 'session');
if (a[0] === 'network' && a[1] === 'inspect') done(s.network, 'network');
if (a[0] === 'network' && a[1] === 'connect') {
  if (s.connectFails) fail();
  s.connected = true;
  if (a[2] !== s.network.Id) fail();
  s.session.networks[s.network.Name] = {};
  if (s.extraNetworkAfterConnect) s.session.networks.foreign = {};
  done();
}
if (a[0] === 'exec') {
  if (a[1] !== '--user' || a[2] !== '0:0') fail();
  const command = a[4];
  if (command === '/bin/sh') {
    // The one listing of both families and the IPv6 switches, as the
    // guard's script prints it.
    if (s.execFails) fail();
    const script = a.at(-1);
    if (!script.includes('-S FORWARD') || !script.includes('/conf/*/disable_ipv6')) fail();
    const out = [];
    for (const [name, family] of [['iptables', 'v4'], ['ip6tables', 'v6']]) {
      if (s.listFails === family || (family === 'v6' && s.noIpv6Tables)) { out.push('#tale-forward ' + name + ' 1'); continue; }
      const guarded = s.guarded[family] && !(s.connected && s.guardLostAfterConnect === family);
      out.push('#tale-forward ' + name + ' 0', '-P FORWARD ACCEPT', guarded ? '-A FORWARD -i eth+ -m conntrack ! --ctstate RELATED,ESTABLISHED -j DROP' : '-A FORWARD -j ACCEPT');
    }
    const disabled = s.ipv6Disabled && !(s.connected && s.ipv6EnabledAfterConnect);
    out.push('#tale-forward ipv6-disabled ' + (disabled ? '0' : '1'));
    done(out.join('\n') + '\n', 'firewall');
  }
  const family = command === '/usr/sbin/iptables' ? 'v4' : command === '/usr/sbin/ip6tables' ? 'v6' : '';
  if (!family) fail();
  if (a.includes('-I')) {
    if (s.installFails === family) fail();
    if (s.installNoop !== family) s.guarded[family] = true;
    done();
  }
}
fail();
`;

const organizationId = 'org-guard';
const containerName = 'tale-sbx-ses-guard';
const cfg = { egressNetwork: 'tale-sandbox-net' };
const networkName = buildkitdNetworkName(organizationId);
function initialState() {
  return {
    session: {
      labels: { 'tale.sandbox-session': '1', 'tale.org': organizationId },
      networks: { [cfg.egressNetwork]: {} } as Record<string, object>,
      running: true,
    },
    network: {
      Id: 'e'.repeat(64),
      Name: networkName,
      Labels: { 'tale.buildkitd': '1', 'tale.org': organizationId },
      Driver: 'bridge',
      Internal: true,
      EnableIPv6: false,
      IPAM: { Config: [{ Subnet: '172.22.0.0/16' }] },
    },
    guarded: { v4: false, v6: false },
    listFails: '',
    installFails: '',
    installNoop: '',
    connectFails: false,
    connected: false,
    noIpv6Tables: false,
    ipv6Disabled: false,
    ipv6EnabledAfterConnect: false,
    guardLostAfterConnect: '',
    extraNetworkAfterConnect: false,
    execFails: false,
    truncated: '',
  };
}
let root = '';
const originalDockerBin = process.env.DOCKER_BIN;
async function save(state: ReturnType<typeof initialState>) {
  await writeFile(join(root, 'state.json'), JSON.stringify(state));
}
async function calls(): Promise<string[][]> {
  const text = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim();
  return text ? text.split('\n').map((line) => JSON.parse(line)) : [];
}
async function attach() {
  const planned = await readBuildkitNetworkPlan(organizationId);
  return attachBuildkitNetwork(cfg, containerName, organizationId, planned);
}
async function expectFailure(message: string) {
  try {
    await attach();
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toContain(
      message,
    );
    return;
  }
  throw new Error('Expected network attachment to fail');
}
async function expectDetached() {
  expect(
    (await calls()).some(
      (call) => call[0] === 'network' && call[1] === 'connect',
    ),
  ).toBe(false);
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-build-network-guard-'));
  const docker = join(root, 'docker');
  await writeFile(docker, FAKE_DOCKER);
  await chmod(docker, 0o755);
  process.env.DOCKER_BIN = docker;
});
beforeEach(async () => {
  await save(initialState());
  await writeFile(join(root, 'calls.jsonl'), '');
});
afterAll(async () => {
  if (originalDockerBin === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = originalDockerBin;
  await rm(root, { recursive: true, force: true });
});

describe('verified session build-network attachment', () => {
  test('refuses a same-name replacement after planning instead of attaching it', async () => {
    const planned = await readBuildkitNetworkPlan(organizationId);
    const changed = initialState();
    changed.network.Id = 'f'.repeat(64);
    await save(changed);
    let error: unknown;
    try {
      await attachBuildkitNetwork(cfg, containerName, organizationId, planned);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof Error ? error.message : '').toContain(
      'changed during session startup',
    );
    await expectDetached();
  });

  test('repairs an old runtime firewall before attaching only its own org network', async () => {
    await attach();
    const observed = await calls();
    const connect = observed.findIndex(
      (call) => call[0] === 'network' && call[1] === 'connect',
    );
    expect(observed[connect]).toEqual([
      'network',
      'connect',
      'e'.repeat(64),
      containerName,
    ]);
    const listings = (from: number, to: number) =>
      observed.slice(from, to).filter((call) => call.includes('/bin/sh'));
    for (const family of ['iptables', 'ip6tables']) {
      const inserted = observed.findIndex(
        (call) => call.includes(`/usr/sbin/${family}`) && call.includes('-I'),
      );
      expect(inserted).toBeGreaterThan(0);
      expect(inserted).toBeLessThan(connect);
      // Read again after the repair, before the attachment.
      expect(listings(inserted + 1, connect).length).toBeGreaterThan(0);
    }
    // One listing before the repair, one after it, one after attaching.
    expect(listings(0, connect)).toHaveLength(2);
    expect(listings(connect + 1, observed.length)).toHaveLength(1);
    expect(
      observed.some((call) => call.some((arg) => arg.includes('.Config.Env'))),
    ).toBe(false);
  });

  test('an already guarded runtime costs one firewall exec before attaching and one after', async () => {
    const state = initialState();
    state.guarded = { v4: true, v6: true };
    await save(state);
    await attach();
    const observed = await calls();
    expect(observed.some((call) => call.includes('-I'))).toBe(false);
    expect(observed.filter((call) => call[0] === 'exec')).toHaveLength(2);
    // The session and its build network are each read once before the
    // attachment and the session once after it.
    expect(observed.filter((call) => call[0] === 'inspect')).toHaveLength(2);
  });

  test('an exec that fails reads as an unreadable firewall', async () => {
    const state = initialState();
    state.execFails = true;
    await save(state);
    await expectFailure('cannot inspect session forwarding guard');
    await expectDetached();
  });

  test('a listing missing a family is never read as an empty one', () => {
    expect(() =>
      parseForwardRules(
        '#tale-forward iptables 0\n-P FORWARD ACCEPT\n#tale-forward ipv6-disabled 0\n',
      ),
    ).toThrow('incomplete');
    expect(
      parseForwardRules(
        '#tale-forward iptables 0\n-P FORWARD ACCEPT\n-A FORWARD -j DROP\n#tale-forward ip6tables 1\n#tale-forward ipv6-disabled 0\n',
      ),
    ).toEqual({
      iptables: '-P FORWARD ACCEPT\n-A FORWARD -j DROP',
      ip6tables: null,
      ipv6Disabled: true,
    });
  });

  test('unreadable IPv4 firewall cannot attach', async () => {
    const state = initialState();
    state.listFails = 'v4';
    await save(state);
    await expectFailure('cannot inspect session forwarding guard');
    await expectDetached();
  });

  test('successful firewall command without the actual first rule cannot attach', async () => {
    const state = initialState();
    state.installNoop = 'v4';
    await save(state);
    await expectFailure('not the first rule');
    await expectDetached();
  });

  test.each(['v4', 'v6'])(
    'failed %s rule installation cannot attach',
    async (family) => {
      const state = initialState();
      state.installFails = family;
      await save(state);
      await expectFailure('cannot install');
      await expectDetached();
    },
  );

  test('missing IPv6 netfilter allows only fully disabled IPv6, checked again after attachment', async () => {
    const state = initialState();
    state.noIpv6Tables = true;
    await save(state);
    await expectFailure('IPv6 is enabled');
    await expectDetached();
    state.ipv6Disabled = true;
    await save(state);
    await writeFile(join(root, 'calls.jsonl'), '');
    await attach();
    const checks = (await calls()).filter((call) => call.includes('/bin/sh'));
    // Before and after the IPv4 repair, and after attaching.
    expect(checks).toHaveLength(3);
    expect(checks[0]?.at(-1)).toContain('/conf/default/disable_ipv6');
    expect(checks[0]?.at(-1)).toContain('/conf/*/disable_ipv6');
    expect(
      (await calls()).some((call) => call.includes('/usr/sbin/ip6tables')),
    ).toBe(false);
  });

  test('IPv6 unexpectedly enabled by attachment fails final verification', async () => {
    const state = initialState();
    state.noIpv6Tables = true;
    state.ipv6Disabled = true;
    state.ipv6EnabledAfterConnect = true;
    await save(state);
    await expectFailure('IPv6 is enabled');
  });

  test.each(['session', 'network'])(
    'refuses a foreign %s without touching its firewall or attaching',
    async (resource) => {
      const state = initialState();
      if (resource === 'session')
        state.session.labels['tale.org'] = 'other-org';
      else state.network.Labels['tale.org'] = 'other-org';
      await save(state);
      await expectFailure('refusing foreign');
      expect((await calls()).some((call) => call[0] === 'exec')).toBe(false);
      await expectDetached();
    },
  );

  test.each([
    ['172.31.0.0/16', 'overlaps the inner Docker'],
    ['8.8.8.0/24', 'must use an RFC1918'],
  ])(
    'rechecks an unsafe %s destination subnet before attachment',
    async (subnet, message) => {
      const state = initialState();
      state.network.IPAM.Config = [{ Subnet: subnet }];
      await save(state);
      await expectFailure(message);
      await expectDetached();
    },
  );

  test('an empty destination subnet list cannot attach', async () => {
    const state = initialState();
    state.network.IPAM.Config = [];
    await save(state);
    await expectFailure('no IPv4 subnet');
    await expectDetached();
  });

  test('refuses an IPv6-enabled destination network before firewall changes', async () => {
    const state = initialState();
    state.network.EnableIPv6 = true;
    await save(state);
    await expectFailure('non-private session build network');
    expect((await calls()).some((call) => call[0] === 'exec')).toBe(false);
    await expectDetached();
  });

  test('refuses an extra pre-existing session network', async () => {
    const state = initialState();
    state.session.networks.foreign = {};
    await save(state);
    await expectFailure('unexpected session networks');
    await expectDetached();
  });

  test.each(['session', 'network', 'firewall'])(
    'truncated %s metadata is never accepted as proof',
    async (observation) => {
      const state = initialState();
      state.truncated = observation;
      await save(state);
      await expectFailure('truncated');
      await expectDetached();
    },
  );

  test('failed attachment is fatal to creation', async () => {
    const state = initialState();
    state.connectFails = true;
    await save(state);
    await expectFailure('cannot attach');
  });

  test.each(['v4', 'v6'])(
    'displaced %s guard after attachment fails without claiming protection',
    async (family) => {
      const state = initialState();
      state.guardLostAfterConnect = family;
      await save(state);
      await expectFailure('not the first rule');
    },
  );

  test('unexpected final network membership is rejected', async () => {
    const state = initialState();
    state.extraNetworkAfterConnect = true;
    await save(state);
    await expectFailure('unexpected session networks');
  });
});
