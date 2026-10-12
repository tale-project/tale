import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  OPERATOR_MARKER,
  operatorBlock,
  readOperatorBlock,
} from './operator-block.ts';

const LAB = resolve(import.meta.dir, 'lab.sh');
const DOC = resolve(import.meta.dir, '../../docs/incus.md');

/** The `readonly NAME=value` lines of lab.sh. */
function labConstants(): Record<string, string> {
  const constants: Record<string, string> = {};
  for (const line of readFileSync(LAB, 'utf8').split('\n')) {
    const match = /^readonly ([A-Z_]+)=(\S+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      constants[match[1]] = match[2].replaceAll(/^['"]|['"]$/g, '');
    }
  }
  return constants;
}

describe('operatorBlock', () => {
  test('takes the first fenced block after the marker', () => {
    const markdown = [
      'before',
      OPERATOR_MARKER,
      '',
      '```',
      'incus one',
      'incus two',
      '```',
      '```',
      'not this',
      '```',
    ].join('\n');
    expect(operatorBlock(markdown)).toBe('incus one\nincus two\n');
  });

  test('refuses a document without the marker', () => {
    expect(() => operatorBlock('```\nincus one\n```')).toThrow(
      'has no <!-- e2e:operator-setup --> line',
    );
  });

  test('refuses a marker that is not directly above a block', () => {
    const markdown = [
      OPERATOR_MARKER,
      '',
      'a paragraph',
      '',
      '```',
      'incus one',
      '```',
    ].join('\n');
    expect(() => operatorBlock(markdown)).toThrow('not directly above');
  });

  test('refuses a block that never closes, and an empty one', () => {
    expect(() =>
      operatorBlock(`${OPERATOR_MARKER}\n\`\`\`\nincus one`),
    ).toThrow('never closes');
    expect(() => operatorBlock(`${OPERATOR_MARKER}\n\`\`\`\n\`\`\``)).toThrow(
      'is empty',
    );
  });
});

describe('docs/incus.md operator block', () => {
  const block = readOperatorBlock(DOC);
  const commands = block
    .replaceAll(/\s*\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));

  test('is a list of incus commands and nothing else', () => {
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) {
      expect(command.startsWith('incus ')).toBe(true);
    }
  });

  test('has no placeholder an operator would have to fill in', () => {
    expect(block).not.toMatch(/<[a-z-]+>/);
  });

  test('creates everything the lab names, under the names the lab uses', () => {
    const lab = labConstants();
    expect(commands).toContainEqual(
      expect.stringContaining(`incus network create ${lab.NETWORK} `),
    );
    expect(commands).toContainEqual(
      expect.stringContaining(`incus project create ${lab.PROJECT} `),
    );
    expect(commands).toContainEqual(`incus network acl create ${lab.ACL}`);
    expect(commands).toContainEqual(
      expect.stringContaining(`incus profile create ${lab.PROFILE} `),
    );
    expect(commands).toContainEqual(
      expect.stringContaining(
        `incus profile device add ${lab.PROFILE} root disk path=/ pool=${lab.POOL} `,
      ),
    );
    expect(commands).toContainEqual(
      expect.stringContaining(
        `incus profile device add ${lab.PROFILE} eth0 nic network=${lab.NETWORK} security.acls=${lab.ACL} security.port_isolation=true`,
      ),
    );
    expect(commands).toContainEqual(
      expect.stringContaining(
        `incus config trust add-certificate client.crt --name ${lab.CLIENT_NAME} --restricted --projects ${lab.PROJECT}`,
      ),
    );
  });

  test('names the lab addresses: the proxy, the stand-ins and the spawner', () => {
    const lab = labConstants();
    const text = commands.join('\n');
    expect(text).toContain(
      `egress action=allow destination=${lab.EGRESS_ADDRESS}/32 protocol=tcp destination_port=3128`,
    );
    expect(text).toContain(
      `egress action=allow destination=${lab.EGRESS_ADDRESS}/32 protocol=udp destination_port=53`,
    );
    expect(text).toContain(
      `egress action=allow destination=${lab.GATEWAY_ADDRESS}/32 protocol=tcp destination_port=8080`,
    );
    expect(text).toContain(
      `egress action=allow destination=${lab.BACKEND_ADDRESS}/32 protocol=tcp destination_port=3005`,
    );
    // The spawner runs on the node: its calls to a session come from the
    // bridge's own address.
    expect(text).toContain(
      `ingress action=allow source=${lab.BRIDGE_ADDRESS}/32 protocol=tcp destination_port=8200`,
    );
    expect(text).toContain(`ipv4.address=${lab.BRIDGE_ADDRESS}/24`);
    expect(text).toContain('raw.dnsmasq=no-resolv');
  });

  test('keeps every address the lab or the ACL names out of the DHCP pool', () => {
    const lab = labConstants();
    const range =
      /ipv4\.dhcp\.ranges=(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+)/.exec(
        commands.join('\n'),
      );
    if (range?.[1] === undefined || range[2] === undefined) {
      throw new Error('the sandbox network sets no ipv4.dhcp.ranges');
    }
    const last = (address: string) => Number(address.split('.')[3]);
    const [low, high] = [last(range[1]), last(range[2])];
    expect(low).toBeLessThan(high);
    for (const address of [
      lab.BRIDGE_ADDRESS,
      lab.EGRESS_ADDRESS,
      lab.GATEWAY_ADDRESS,
      lab.BACKEND_ADDRESS,
    ]) {
      if (address === undefined) throw new Error('lab.sh names no address');
      expect(last(address) < low || last(address) > high).toBe(true);
    }
  });

  test('is the project the doc says a sandbox project must be', () => {
    const text = commands.join('\n');
    for (const setting of [
      'features.images=true',
      'features.profiles=true',
      'features.storage.volumes=true',
      'restricted=true',
    ]) {
      expect(text).toContain(`-c ${setting}`);
    }
    // Disk devices stay at the default (pool-backed only): `allow` without a
    // path list admits every host path, and no path list admits `tmpfs:`.
    expect(text).not.toContain('restricted.devices.disk');
    // Docker inside is the suite's own opt-in, never the baseline.
    expect(text).not.toContain('restricted.containers.nesting');
    expect(text).not.toContain('restricted.containers.lowlevel');
  });
});
