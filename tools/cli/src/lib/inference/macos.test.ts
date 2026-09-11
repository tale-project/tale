import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import {
  launchAgentMatches,
  persistedPlistMatches,
  probeOmlxRuntime,
  verifyOmlxApp,
  verifyLaunchAgentCustody,
  type InferenceExec,
} from './macos';
import { OMLX_RUNTIME, parseInferenceSpec } from './model';
import { launchAgentPlist } from './settings';
import { inferenceFixture } from './tests/fixture';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-inference-mac-adapter-'));
  roots.push(root);
  const app = join(root, 'oMLX.app');
  await mkdir(app);
  const calls: { command: string; args: string[] }[] = [];
  const run: InferenceExec = async (command, args, options) => {
    calls.push({ command, args });
    expect(options?.silent).toBe(true);
    expect(options?.env?.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
    let stdout = '';
    if (args.includes('-dv'))
      stdout = `TeamIdentifier=${OMLX_RUNTIME.teamId}\nIdentifier=${OMLX_RUNTIME.bundleIdentifier}\nCandidateCDHashFull sha256=${OMLX_RUNTIME.arm64CodeDirectory}`;
    if (command.endsWith('plutil')) stdout = OMLX_RUNTIME.version;
    return { success: true, exitCode: 0, stdout, stderr: '' };
  };
  return { root, app, calls, run };
}
describe('macOS runtime adapter without launching bundled code', () => {
  test('admits only absent or exact retained LaunchAgent state without any process mutation', async () => {
    const node = parseInferenceSpec(inferenceFixture()).nodes[0]!;
    const state =
      '/Users/inference/Library/Application Support/Tale/inference/studio-one';
    const release = 'a'.repeat(64);
    const path =
      '/Users/inference/Library/LaunchAgents/dev.tale.inference.studio-one.plist';
    const expected = launchAgentPlist(
      node,
      state,
      release,
      join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app'),
    );
    let content: string | undefined;
    let loaded = false;
    let exitCode = 113;
    let loadedRelease = release;
    const run: InferenceExec = async (command, args) => {
      expect(command).toBe('/bin/launchctl');
      expect(args).toEqual(['print', `gui/501/dev.tale.inference.${node.key}`]);
      return {
        success: loaded,
        exitCode: loaded ? 0 : exitCode,
        stdout: loaded
          ? `path = ${path}\n${state}/releases/${loadedRelease}/runtime-admission.py\nstate = running`
          : '',
        stderr: '',
      };
    };
    const inspect = async (file: string, wanted: string) => {
      expect(file).toBe(path);
      if (content === undefined)
        throw Object.assign(new Error('absent'), { code: 'ENOENT' });
      return content === wanted;
    };
    const check = (releases: string[]) =>
      verifyLaunchAgentCustody(node, 501, state, releases, run, inspect);
    await check([]);
    content = expected;
    await expect(check([])).rejects.toThrow('unrecorded or changed');
    await check([release]);
    loaded = true;
    await check([release]);
    loadedRelease = 'b'.repeat(64);
    await expect(check([release])).rejects.toThrow('unrecorded or changed');
    loadedRelease = release;
    content = expected.replace('runtime-admission.py', 'foreign-admission.py');
    await expect(check([release])).rejects.toThrow('unrecorded or changed');
    content = undefined;
    await expect(check([release])).rejects.toThrow('unrecorded or changed');
    loaded = false;
    exitCode = 1;
    await expect(check([])).rejects.toThrow('inventory could not be verified');
  });
  test.skipIf(process.platform === 'win32')(
    'requires exact active plist bytes as well as a running launchd identity',
    async () => {
      const f = await fixture();
      const node = parseInferenceSpec(inferenceFixture()).nodes[0]!;
      const state =
        '/Users/inference/Library/Application Support/Tale/inference/studio-one';
      const release = 'a'.repeat(64);
      const uid = userInfo().uid;
      const activePath = `/Users/inference/Library/LaunchAgents/dev.tale.inference.studio-one.plist`;
      const run: InferenceExec = async () => ({
        success: true,
        exitCode: 0,
        stdout: `path = ${activePath}\n${state}/releases/${release}/runtime-admission.py\nstate = running\n`,
        stderr: '',
      });
      let checked = 0;
      const inspect = async (
        file: string,
        expected: string,
        owner?: number,
      ) => {
        expect(file).toBe(activePath);
        expect(owner).toBe(uid);
        expect(expected).toBe(
          launchAgentPlist(
            node,
            state,
            release,
            join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app'),
          ),
        );
        checked++;
        return false;
      };
      expect(
        await launchAgentMatches(node, uid, state, release, run, inspect),
      ).toBe(false);
      expect(checked).toBe(1);
      expect(
        await launchAgentMatches(
          node,
          uid,
          state,
          release,
          run,
          async () => true,
        ),
      ).toBe(true);
      const file = join(f.root, 'active.plist');
      await writeFile(file, 'exact private bytes', { mode: 0o600 });
      expect(
        await persistedPlistMatches(file, 'exact private bytes', uid),
      ).toBe(true);
      expect(await persistedPlistMatches(file, 'different bytes', uid)).toBe(
        false,
      );
      expect(
        await persistedPlistMatches(file, 'exact private bytes', uid + 1),
      ).toBe(false);
      if (process.platform !== 'win32') {
        await chmod(file, 0o644);
        expect(
          await persistedPlistMatches(file, 'exact private bytes', uid),
        ).toBe(false);
      }
    },
  );
  test('requires notarization, deep signature and exact signed arm64 content', async () => {
    const f = await fixture();
    await verifyOmlxApp(f.app, f.run);
    expect(
      f.calls.some(
        (call) =>
          call.args.includes('--deep') && call.args.includes('--strict'),
      ),
    ).toBe(true);
    expect(f.calls.some((call) => call.command.endsWith('spctl'))).toBe(true);
    expect(f.calls.find((call) => call.args.includes('-dv'))?.args).toContain(
      'arm64',
    );
    await expect(
      verifyOmlxApp(f.app, async (command, args, options) => {
        const result = await f.run(command, args, options);
        if (args.includes('-dv'))
          result.stdout = result.stdout.replace(
            OMLX_RUNTIME.arm64CodeDirectory,
            '0'.repeat(64),
          );
        return result;
      }),
    ).rejects.toThrow('signed content');
  });
  test('refuses failed Apple security assessment without attempting an override', async () => {
    const f = await fixture();
    await expect(
      verifyOmlxApp(f.app, async (command, args, options) => {
        const result = await f.run(command, args, options);
        if (command.endsWith('spctl')) result.success = false;
        return result;
      }),
    ).rejects.toThrow('security settings');
    expect(f.calls.some((call) => call.args.includes('--master-disable'))).toBe(
      false,
    );
  });
  test.skipIf(process.platform === 'win32')(
    'refuses a linked runtime before any process invocation',
    async () => {
      const f = await fixture();
      const link = join(f.root, 'linked.app');
      await symlink(f.app, link);
      await expect(verifyOmlxApp(link, f.run)).rejects.toThrow(
        'regular directory',
      );
      expect(f.calls).toHaveLength(0);
    },
  );
  test('validates actual kernel-probe output and uses only fixed code with a scrubbed environment', async () => {
    const f = await fixture();
    const node = parseInferenceSpec(inferenceFixture()).nodes[0]!;
    const good = await probeOmlxRuntime(
      f.app,
      node,
      async (command, args, options) => {
        expect(command).toEndWith('Python/cpython-3.11/bin/python3');
        expect(args).toContain('-s');
        expect(args.at(-1)).toContain('native_kernel_status()');
        expect(options?.env?.HF_HUB_OFFLINE).toBe('1');
        expect(options?.env?.PYTHONNOUSERSITE).toBe('1');
        expect(options?.env).not.toHaveProperty(
          'TALE_INFERENCE_STUDIO_ADMIN_KEY',
        );
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            metalWorkingSetBytes: 123,
            availableKernels: ['glm_moe_dsa'],
          }),
          stderr: '',
        };
      },
    );
    expect(good.availableKernels).toEqual(['glm_moe_dsa']);
    await expect(
      probeOmlxRuntime(f.app, node, async () => ({
        success: true,
        exitCode: 0,
        stdout: 'private malformed upstream details',
        stderr: '',
      })),
    ).rejects.toThrow('invalid kernel admission');
  });
});
