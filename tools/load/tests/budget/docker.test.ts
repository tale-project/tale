import { describe, expect, test } from 'bun:test';

import {
  ENGINE_FORMAT,
  type EngineFacts,
  belongsTo,
  colourOf,
  dockerContainerSource,
  engineRefusal,
  parseEngine,
  parsePids,
  parsePs,
  psArguments,
} from '../../src/budget/docker.ts';

const id = (digit: string): string => digit.repeat(64);

function row(
  containerId: string,
  name: string,
  project: string,
  service: string,
  number = '1',
  oneoff = 'False',
): string {
  return [containerId, name, project, service, number, oneoff].join('\t');
}

describe('the deployment’s Compose projects', () => {
  test('its own project and one per colour, nothing else', () => {
    expect(colourOf('tale-x', 'tale-x')).toBeNull();
    expect(colourOf('tale-x', 'tale-x-blue')).toBe('blue');
    expect(colourOf('tale-x', 'tale-x-green')).toBe('green');
    expect(belongsTo('tale-x', 'tale-x-green')).toBe(true);
    expect(belongsTo('tale-x', 'tale-x-red')).toBe(false);
    expect(belongsTo('tale-x', 'tale')).toBe(false);
  });
});

describe('parsePs', () => {
  test('keeps the deployment’s Compose-made containers, sorted', () => {
    const stdout = [
      row(id('1'), 'tale-x-sandbox', 'tale-x', 'sandbox'),
      row(id('2'), 'tale-x-db', 'tale-x', 'db'),
      row(id('3'), 'tale-x-blue-platform-1', 'tale-x-blue', 'platform'),
      // Another deployment on the same host.
      row(id('4'), 'other-db', 'other', 'db'),
      // A one-off `compose run` is no replica of its service.
      row(id('5'), 'tale-x-db-run-1', 'tale-x', 'db', '1', 'True'),
      // A container that inherited the labels from its image has no number.
      row(id('6'), 'stray', 'tale-x', 'db', ''),
      'not a row',
      '',
    ].join('\n');
    expect(parsePs(stdout, 'tale-x')).toEqual([
      { id: id('2'), name: 'tale-x-db', project: 'tale-x', service: 'db' },
      {
        id: id('1'),
        name: 'tale-x-sandbox',
        project: 'tale-x',
        service: 'sandbox',
      },
      {
        id: id('3'),
        name: 'tale-x-blue-platform-1',
        project: 'tale-x-blue',
        service: 'platform',
      },
    ]);
  });

  test('lists running containers by their container-number label', () => {
    const args = psArguments();
    expect(args).toContain('--no-trunc');
    expect(args).toContain('label=com.docker.compose.container-number');
    expect(args).not.toContain('-a');
  });
});

describe('parsePids and parseEngine', () => {
  test('a pid per id; a stopped container’s 0 stays 0', () => {
    expect(parsePids(`${id('1')}\t4242\n${id('2')}\t0\n\n`)).toEqual(
      new Map([
        [id('1'), 4242],
        [id('2'), 0],
      ]),
    );
  });

  test('the engine’s cgroup driver, version, server, architecture and whether it runs rootless', () => {
    expect(ENGINE_FORMAT).toContain('{{json .SecurityOptions}}');
    expect(
      parseEngine(
        'systemd\t2\t28.1.1\tx86_64\t["name=apparmor","name=seccomp,profile=builtin","name=cgroupns"]\n',
      ),
    ).toEqual({
      cgroupDriver: 'systemd',
      cgroupVersion: 2,
      serverVersion: '28.1.1',
      architecture: 'x86_64',
      rootless: false,
    });
    expect(
      parseEngine(
        'systemd\t2\t28.1.1\tx86_64\t["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]\n',
      ).rootless,
    ).toBe(true);
    expect(parseEngine('cgroupfs\t2\t27.0.3\taarch64\tnull\n').rootless).toBe(
      false,
    );
    expect(parseEngine('<no value>\t\t\t\t')).toEqual({
      cgroupDriver: null,
      cgroupVersion: null,
      serverVersion: null,
      architecture: null,
      rootless: null,
    });
  });
});

describe('engineRefusal', () => {
  const engine = (overrides: Partial<EngineFacts> = {}): EngineFacts => ({
    cgroupDriver: 'systemd',
    cgroupVersion: 2,
    serverVersion: '28.1.1',
    architecture: 'x86_64',
    rootless: false,
    ...overrides,
  });

  test('a rootful cgroup v2 engine of either driver gives the reading', () => {
    expect(engineRefusal(engine())).toBeNull();
    expect(engineRefusal(engine({ cgroupDriver: 'cgroupfs' }))).toBeNull();
  });

  test('cgroup v1, a rootless engine and the none driver are refused', () => {
    expect(engineRefusal(engine({ cgroupVersion: 1 }))).toContain('cgroup v1');
    expect(engineRefusal(engine({ cgroupVersion: null }))).toContain(
      'cgroup v?',
    );
    expect(engineRefusal(engine({ rootless: true }))).toContain('rootless');
    expect(engineRefusal(engine({ cgroupDriver: 'none' }))).toContain(
      'cgroup driver is none',
    );
  });
});

describe('dockerContainerSource', () => {
  test('lists, then reads the pids of what it listed', async () => {
    const calls: string[][] = [];
    const source = dockerContainerSource('tale-x', async (args) => {
      calls.push([...args]);
      if (args[0] === 'ps') {
        return `${row(id('3'), 'tale-x-green-platform-1', 'tale-x-green', 'platform')}\n`;
      }
      return `${id('3')}\t555\n`;
    });
    expect(await source.list()).toEqual([
      {
        id: id('3'),
        name: 'tale-x-green-platform-1',
        project: 'tale-x-green',
        service: 'platform',
        colour: 'green',
        pid: 555,
      },
    ]);
    expect(calls[1]).toEqual([
      'inspect',
      '--format',
      '{{.Id}}\t{{.State.Pid}}',
      id('3'),
    ]);
  });

  test('one container gone between the listing and its inspect does not blind the others', async () => {
    const calls: string[][] = [];
    const source = dockerContainerSource('tale-x', async (args) => {
      calls.push([...args]);
      if (args[0] === 'ps') {
        return [
          row(id('1'), 'tale-x-db', 'tale-x', 'db'),
          row(id('2'), 'tale-x-blue-platform-1', 'tale-x-blue', 'platform'),
        ].join('\n');
      }
      // `docker inspect` fails as a whole when one of its objects is gone.
      if (args.includes(id('2'))) {
        throw new Error(
          `docker inspect failed: Error: No such object: ${id('2')}`,
        );
      }
      return `${id('1')}\t4242\n`;
    });
    const listed = await source.list();
    expect(listed.map((c) => [c.service, c.pid])).toEqual([
      ['db', 4242],
      ['platform', 0],
    ]);
    // One inspect for both, then one for each of them.
    expect(calls.filter((call) => call[0] === 'inspect')).toHaveLength(3);
  });

  test('an empty deployment asks for no pids', async () => {
    const calls: string[][] = [];
    const source = dockerContainerSource('tale-x', async (args) => {
      calls.push([...args]);
      return '';
    });
    expect(await source.list()).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
