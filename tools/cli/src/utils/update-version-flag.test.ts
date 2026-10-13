import { describe, expect, test } from 'bun:test';

import { Command } from 'commander';

import { routeUpdateVersionFlag } from './update-version-flag';

const argv = (...args: string[]) => ['bun', 'tale', ...args];

/** The program's shape where it matters: Commander's root `--version` and
 * `update`'s own `-v, --version <version>`. */
function program() {
  const seen: { version?: string; printed?: string } = {};
  const root = new Command('tale')
    .version('9.9.9')
    .option('-y, --yes')
    .option('--ci')
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        seen.printed = text.trim();
      },
    });
  root.addCommand(
    new Command('update')
      .option('-v, --version <version>')
      .option('--dry-run')
      .action((options: { version?: string }) => {
        seen.version = options.version;
      }),
  );
  return { root, seen };
}

describe('tale update --version', () => {
  test('without routing, the root --version claims it and nothing updates', async () => {
    const { root, seen } = program();
    await expect(
      root.parseAsync(argv('update', '--version', '0.5.77')),
    ).rejects.toThrow();
    expect(seen.printed).toBe('9.9.9');
    expect(seen.version).toBeUndefined();
  });

  test('reaches update as its own option, in every spelling', async () => {
    for (const args of [
      ['update', '--version', '0.5.77'],
      ['update', '--version=0.5.77'],
      ['--ci', '-y', 'update', '--dry-run', '--version', '0.5.77'],
      ['update', '-v', '0.5.77'],
    ]) {
      const { root, seen } = program();
      await root.parseAsync(routeUpdateVersionFlag(argv(...args)));
      expect(seen.version).toBe('0.5.77');
      expect(seen.printed).toBeUndefined();
    }
  });

  test('leaves the program version and every other command alone', () => {
    for (const args of [
      ['--version'],
      ['-V'],
      ['deploy', '--version'],
      ['status', '--json'],
      ['update'],
      ['update', '--', '--version'],
    ])
      expect(routeUpdateVersionFlag(argv(...args))).toEqual(argv(...args));
  });
});
