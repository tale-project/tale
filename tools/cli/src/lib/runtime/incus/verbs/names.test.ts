import { describe, expect, test } from 'bun:test';

import { goldenTarget } from '../apply/apply-fixture';
import {
  colourDocument,
  compileInput,
  statefulDocument,
} from '../compile/compile-fixture';
import { compileStackTarget } from '../compile/stack-target';
import {
  HOSTS_FILE,
  NAMES_VOLUME,
  renderHostRecords,
  renderResolverConfig,
  resolverFiles,
} from './names';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A stack view with both colours up: a colour's name answers every
 * replica of it, the stable names answer the switch. */
const STACK_VIEW = {
  'backend-api': ['10.30.1.5'],
  'backend-api-blue': ['10.30.1.80', '10.30.1.81'],
  'backend-api-green': ['10.30.1.144', '10.30.1.145'],
  db: ['10.30.1.6'],
  'host.docker.internal': ['10.30.0.1'],
  platform: ['10.30.1.5'],
  'platform-blue': ['10.30.1.64', '10.30.1.65'],
  'platform-green': ['10.30.1.128', '10.30.1.129'],
};
const SESSION_VIEW = {
  'backend-api': ['10.30.1.5'],
  'backend-relay': ['10.30.1.5'],
  'sandbox-llm-gateway': ['10.30.1.9'],
};

describe('the resolvers read what the plan names (design D-16, 5.4)', () => {
  test('the stack view forwards other names to the gateway and answers its own AAAA empty', () => {
    expect(renderResolverConfig('stack', STACK_VIEW, '10.30.0.1')).toBe(
      [
        "# The stack view of the stack's names, written by the Tale CLI (names-hosts/1).",
        '# Records: the files in hosts/. Change them through the CLI, never here.',
        'local-ttl=1',
        'server=10.30.0.1',
        'local=//',
        'local=/backend-api/',
        'local=/backend-api-blue/',
        'local=/backend-api-green/',
        'local=/db/',
        'local=/host.docker.internal/',
        'local=/platform/',
        'local=/platform-blue/',
        'local=/platform-green/',
        '',
      ].join('\n'),
    );
  });

  test('the session view answers only its names and asks nobody else', () => {
    expect(renderResolverConfig('sessions', SESSION_VIEW, '10.30.0.1')).toBe(
      [
        "# The sessions view of the stack's names, written by the Tale CLI (names-hosts/1).",
        '# Records: the files in hosts/. Change them through the CLI, never here.',
        'local-ttl=1',
        'no-resolv',
        'local=//',
        'local=/backend-api/',
        'local=/backend-relay/',
        'local=/sandbox-llm-gateway/',
        '',
      ].join('\n'),
    );
  });

  test('a colour name answers every replica of the colour, one record per address', () => {
    expect(renderHostRecords(STACK_VIEW)).toBe(
      [
        '# names-hosts/1',
        '10.30.1.5 backend-api',
        '10.30.1.80 backend-api-blue',
        '10.30.1.81 backend-api-blue',
        '10.30.1.144 backend-api-green',
        '10.30.1.145 backend-api-green',
        '10.30.1.6 db',
        '10.30.0.1 host.docker.internal',
        '10.30.1.5 platform',
        '10.30.1.64 platform-blue',
        '10.30.1.65 platform-blue',
        '10.30.1.128 platform-green',
        '10.30.1.129 platform-green',
        '',
      ].join('\n'),
    );
    expect(renderHostRecords(SESSION_VIEW)).toBe(
      [
        '# names-hosts/1',
        '10.30.1.5 backend-api',
        '10.30.1.5 backend-relay',
        '10.30.1.9 sandbox-llm-gateway',
        '',
      ].join('\n'),
    );
  });

  test('nothing but a DNS name and an IPv4 address reaches a file', () => {
    const refused: Record<string, string[]>[] = [
      { 'db\nserver=/#/203.0.113.9': ['10.30.1.6'] },
      { 'db/': ['10.30.1.6'] },
      { db: ['10.30.1.6 evil'] },
      { db: ['fd00::6'] },
      { db: [] },
    ];
    for (const names of refused) {
      expect(() => renderHostRecords(names)).toThrow();
      expect(() => renderResolverConfig('stack', names, '10.30.0.1')).toThrow();
    }
    expect(() =>
      renderResolverConfig('stack', SESSION_VIEW, '10.30.0.1\nno-resolv'),
    ).toThrow();
  });

  test('each view is a directory of the names volume: its conf and its records, both written in place', () => {
    const target = goldenTarget('stateful');
    const files = resolverFiles(target);
    expect(
      files.map(({ volume, path, mode, uid, gid, write, instance }) => ({
        volume,
        path,
        mode,
        uid,
        gid,
        write,
        instance,
      })),
    ).toEqual([
      {
        volume: NAMES_VOLUME,
        path: 'stack/dnsmasq.conf',
        mode: 0o644,
        uid: 0,
        gid: 0,
        write: 'overwrite',
        instance: undefined,
      },
      {
        volume: NAMES_VOLUME,
        path: `stack/hosts/${HOSTS_FILE}`,
        mode: 0o644,
        uid: 0,
        gid: 0,
        write: 'overwrite',
        instance: undefined,
      },
      {
        volume: NAMES_VOLUME,
        path: 'sessions/dnsmasq.conf',
        mode: 0o644,
        uid: 0,
        gid: 0,
        write: 'overwrite',
        instance: undefined,
      },
      {
        volume: NAMES_VOLUME,
        path: `sessions/hosts/${HOSTS_FILE}`,
        mode: 0o644,
        uid: 0,
        gid: 0,
        write: 'overwrite',
        instance: undefined,
      },
    ]);
    const [stackConf, stackHosts, sessionConf, sessionHosts] = files.map(
      (file) => decode(file.content),
    );
    expect(stackConf).toBe(
      renderResolverConfig('stack', target.names.stack, '10.30.0.1'),
    );
    expect(stackHosts).toBe(renderHostRecords(target.names.stack));
    expect(sessionConf).toBe(
      renderResolverConfig('sessions', target.names.sessions, '10.30.0.1'),
    );
    expect(sessionHosts).toBe(renderHostRecords(target.names.sessions));
    // The session view never names the database.
    expect(sessionHosts).not.toContain(' db\n');
    // A target without resolvers writes none.
    expect(
      resolverFiles({
        ...target,
        volumes: target.volumes.filter(
          (volume) => volume.name !== NAMES_VOLUME,
        ),
      }),
    ).toEqual([]);
  });

  test('the resolvers run dnsmasq under /init from the egress digest; every instance asks names, the spawner names-sessions', () => {
    const result = compileStackTarget(
      compileInput('workspace', [
        { compose: statefulDocument() },
        { compose: colourDocument('blue'), colour: 'blue' },
      ]),
    );
    if (result.target === null)
      throw new Error(JSON.stringify(result.refusals));
    const target = result.target;
    const egress = target.instances.find(
      (instance) => instance.service === 'sandbox-egress',
    );
    for (const [name, address, view] of [
      ['names', '10.30.1.2', 'stack'],
      ['names-sessions', '10.30.1.3', 'sessions'],
    ] as const) {
      const resolver = target.instances.find(
        (instance) => instance.name === name,
      );
      expect(resolver?.address).toBe(address);
      expect(resolver?.image).toBe(egress?.image ?? '');
      expect(resolver?.config['oci.entrypoint']).toMatch(
        new RegExp(
          `^/init --single-child .*-- dnsmasq --keep-in-foreground --no-hosts --hostsdir=/names/${view}/hosts --conf-file=/names/${view}/dnsmasq\\.conf$`,
        ),
      );
      // Their own resolv.conf names the gateway (R3-09).
      expect(resolver?.config['oci.dns.nameservers']).toBe('10.30.0.1');
      expect(resolver?.devices[NAMES_VOLUME]).toMatchObject({
        source: NAMES_VOLUME,
        path: '/names',
        readonly: 'true',
      });
    }
    for (const instance of target.instances)
      if (instance.service !== 'names' && instance.service !== 'names-sessions')
        expect(instance.config['oci.dns.nameservers']).toBe('10.30.1.2');
    const spawner = target.instances.find(
      (instance) => instance.service === 'sandbox',
    );
    expect(spawner?.config['environment.SANDBOX_INCUS_DNS']).toBe('10.30.1.3');
    // The colour's names answer each of its replicas.
    expect(target.names.stack['platform-blue']).toEqual([
      '10.30.1.64',
      '10.30.1.65',
    ]);
    expect(target.names.stack.platform).toEqual(['10.30.1.5']);
  });
});
