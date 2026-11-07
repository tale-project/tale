import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRecord } from '../../../lib/is-record.ts';
import {
  browserBuild,
  fetchBrowser,
  fetchCommand,
  isInstalled,
  issue,
  outputTail,
  progressOf,
} from './install.ts';

const requireModule = createRequire(import.meta.url);

/** A command that runs this JavaScript, under the runtime that runs the tests. */
function script(code: string): readonly string[] {
  return [process.execPath, '-e', code];
}

const temporary: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sm-install-test-'));
  temporary.push(dir);
  return dir;
}

beforeEach(() => {
  // What a failing command makes the code log is of no interest here.
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of temporary.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('outputTail', () => {
  it('keeps the distinct lines, without colours and progress redraws', () => {
    const output =
      'Downloading 1%\r\u001b[31mConnection refused\u001b[0m\n\n  \nlast\n';
    expect(outputTail(output)).toEqual([
      'Downloading 1%',
      'Connection refused',
      'last',
    ]);
  });

  it('drops a line that repeats the one before it', () => {
    expect(outputTail('10%\r10%\r20%\n20%\n10%')).toEqual([
      '10%',
      '20%',
      '10%',
    ]);
  });

  it('keeps the last twelve lines, or as many as asked for', () => {
    const output = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`,
    ).join('\n');
    const tail = outputTail(output);
    expect(tail).toHaveLength(12);
    expect(tail[0]).toBe('line 9');
    expect(tail.at(-1)).toBe('line 20');
    expect(outputTail(output, 2)).toEqual(['line 19', 'line 20']);
  });

  it('has no lines for no output', () => {
    expect(outputTail('')).toEqual([]);
    expect(outputTail('\r\n \r\n')).toEqual([]);
  });
});

describe('progressOf', () => {
  const bar = (percent: number) =>
    `Downloading Camoufox... [${'█'.repeat(percent / 10)}${'░'.repeat(10 - percent / 10)}] ${percent}% | ETA: 30s | ${percent * 6} MB/624 MB\n`;

  it('is a download without a percentage before the bar has drawn a line', () => {
    expect(progressOf('')).toEqual({ phase: 'downloading', percent: null });
    expect(progressOf('Fetching the latest release...\n')).toEqual({
      phase: 'downloading',
      percent: null,
    });
  });

  it('is the percentage of the last line of the bar', () => {
    expect(progressOf(bar(10) + bar(20) + bar(40))).toEqual({
      phase: 'downloading',
      percent: 40,
    });
  });

  it('is the archive being checked and unpacked once the bar reached 100', () => {
    expect(progressOf(bar(90) + bar(100))).toEqual({
      phase: 'unpacking',
      percent: 100,
    });
  });

  it('reads only the end of a long output', () => {
    const long = bar(30) + 'x'.repeat(10_000) + bar(70);
    expect(progressOf(long)).toEqual({ phase: 'downloading', percent: 70 });
  });
});

describe('fetchBrowser progress', () => {
  it('tells each change of the progress the command prints, once', async () => {
    // One line at a time, as the bar draws them every few seconds.
    const code = `
      const lines = [
        'Downloading Camoufox... [░░] 0% | ETA: 9s | 0 B/624 MB',
        'Downloading Camoufox... [█░] 50% | ETA: 4s | 312 MB/624 MB',
        'Downloading Camoufox... [█░] 50% | ETA: 4s | 312 MB/624 MB',
        'Downloading Camoufox... [██] 100% | ETA: 0s | 624 MB/624 MB',
      ];
      let next = 0;
      const print = () => {
        console.log(lines[next++]);
        if (next < lines.length) setTimeout(print, 40);
      };
      print();
    `;
    const told: unknown[] = [];
    await fetchBrowser({
      command: script(code),
      installed: () => true,
      onProgress: (progress) => told.push(progress),
    });
    expect(told).toEqual([
      { phase: 'downloading', percent: 0 },
      { phase: 'downloading', percent: 50 },
      { phase: 'unpacking', percent: 100 },
    ]);
  });
});

describe('issue', () => {
  it('puts the lines under the summary', () => {
    expect(issue('It failed.', ['a', 'b'])).toBe('It failed.\na\nb');
    expect(issue('It failed.', [])).toBe('It failed.');
  });
});

describe('isInstalled', () => {
  it('is true once the version of the install is known', () => {
    expect(isInstalled(() => '152.0.4-beta.30')).toBe(true);
  });

  it.each(['FileNotFoundError', 'CamoufoxNotInstalled'])(
    'is false when camoufox-js raises %s',
    (name) => {
      expect(
        isInstalled(() => {
          throw Object.assign(new Error('not there'), { name });
        }),
      ).toBe(false);
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it('is false, and says why, for any other problem', () => {
    expect(
      isInstalled(() => {
        throw new SyntaxError('Unexpected token in version.json');
      }),
    ).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('says so once when the same problem comes up again', () => {
    const broken = (): string => {
      throw new SyntaxError('Unexpected end of version.json');
    };
    isInstalled(broken);
    isInstalled(broken);
    isInstalled(broken);
    expect(console.warn).toHaveBeenCalledTimes(1);

    isInstalled(() => {
      throw new SyntaxError('Another problem');
    });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

/**
 * The real camoufox-js answers, in a process of its own: it reads the install
 * directory when it is first loaded, and this process must not read the user's.
 */
describe('isInstalled with camoufox-js', () => {
  function pin(): { version: string; build: string } {
    const data: unknown = JSON.parse(
      readFileSync(
        requireModule.resolve('camoufox-js/dist/data-files/browser-pin.json'),
        'utf8',
      ),
    );
    if (
      !isRecord(data) ||
      typeof data.version !== 'string' ||
      typeof data.build !== 'string'
    ) {
      throw new Error('browser-pin.json has no version and build');
    }
    return { version: data.version, build: data.build };
  }

  function install(installDir: string, version: string, build: string): void {
    const dir = join(installDir, 'browsers', 'official', `${version}-${build}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'version.json'),
      JSON.stringify({ version, build, prerelease: false }),
    );
  }

  function installedIn(installDir: string): string {
    const module = new URL('./install.ts', import.meta.url).href;
    return execFileSync(
      process.execPath,
      [
        '-e',
        `import { isInstalled } from ${JSON.stringify(module)}; console.log(String(isInstalled()));`,
      ],
      {
        env: { ...process.env, CAMOUFOX_INSTALL_DIR: installDir },
        encoding: 'utf8',
      },
    ).trim();
  }

  it('is false for an empty install directory', () => {
    expect(installedIn(tempDir())).toBe('false');
  });

  it('is true once the build that camoufox-js pins is installed', () => {
    const dir = tempDir();
    const { version, build } = pin();
    install(dir, version, build);
    expect(installedIn(dir)).toBe('true');
  });

  it('is false while only another build is installed', () => {
    const dir = tempDir();
    install(dir, '1.2.3', 'beta.1');
    expect(installedIn(dir)).toBe('false');
  });
});

describe('browserBuild', () => {
  it('is the build that camoufox-js pins', () => {
    const data: unknown = JSON.parse(
      readFileSync(
        requireModule.resolve('camoufox-js/dist/data-files/browser-pin.json'),
        'utf8',
      ),
    );
    expect(isRecord(data)).toBe(true);
    expect(browserBuild()).toBe(
      isRecord(data) ? `${String(data.version)}-${String(data.build)}` : '',
    );
    expect(browserBuild()).toMatch(/^\d+(\.\d+)+-\S+$/);
  });
});

describe('fetchCommand', () => {
  it('runs the fetch of the camoufox-js CLI under the current runtime', () => {
    const [runtime, cli, subcommand, ...rest] = fetchCommand();
    expect(runtime).toBe(process.execPath);
    expect(cli).toMatch(/camoufox-js[/\\]dist[/\\]__main__\.js$/);
    expect(existsSync(cli ?? '')).toBe(true);
    expect(subcommand).toBe('fetch');
    expect(rest).toEqual([]);
  });
});

describe('fetchBrowser', () => {
  it('reports the issue when the command fails', async () => {
    const code =
      "console.log('Downloading 1%\\r\\x1b[31mConnection refused\\x1b[0m'); process.exitCode = 3";
    const result = await fetchBrowser({
      command: script(code),
      installed: () => false,
    });
    expect(result).toBe(
      '`camoufox-js fetch` failed (exit code 3).\nDownloading 1%\nConnection refused',
    );
  });

  it('notices that nothing was installed', async () => {
    // camoufox prints "Version ... not found" and exits 0
    const result = await fetchBrowser({
      command: script("console.log('Version not found in cache')"),
      installed: () => false,
    });
    expect(result).toBe(
      '`camoufox-js fetch` finished, but the browser is still not installed.\nVersion not found in cache',
    );
  });

  it('succeeds once the browser is installed, also when a later step failed', async () => {
    const options = { installed: () => true };
    expect(
      await fetchBrowser({
        ...options,
        command: script('process.exitCode = 0'),
      }),
    ).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
    // A later step failed: launches fetch the rest.
    expect(
      await fetchBrowser({
        ...options,
        command: script('process.exitCode = 1'),
      }),
    ).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('asks whether the browser is installed after the command ended', async () => {
    const installed = vi.fn(() => true);
    await fetchBrowser({ command: script('0'), installed });
    expect(installed).toHaveBeenCalledTimes(1);
  });

  it('reports a command that cannot run', async () => {
    const result = await fetchBrowser({
      command: ['/nonexistent/runtime', 'camoufox-js', 'fetch'],
      installed: () => false,
    });
    expect(result).toMatch(/^Could not run `camoufox-js fetch`: /);
    expect(result?.split('\n')).toHaveLength(1);
  });

  it('reports an empty command', async () => {
    const result = await fetchBrowser({ command: [], installed: () => false });
    expect(result).toMatch(/^Could not run `camoufox-js fetch`: /);
  });

  it('reports a command killed by a signal', async () => {
    const result = await fetchBrowser({
      command: script(
        "console.log('working'); process.kill(process.pid, 'SIGKILL')",
      ),
      installed: () => false,
    });
    expect(result).toBe(
      '`camoufox-js fetch` failed (stopped by SIGKILL).\nworking',
    );
  });

  it('collects what the command prints on both streams', async () => {
    const result = await fetchBrowser({
      command: script(
        "console.log('to stdout'); console.error('to stderr'); process.exitCode = 2",
      ),
      installed: () => false,
    });
    expect(result?.split('\n')).toEqual(
      expect.arrayContaining(['to stdout', 'to stderr']),
    );
    expect(result).toContain('exit code 2');
  });

  it('runs the command with colours off and the install directory of the app', async () => {
    vi.stubEnv('CAMOUFOX_INSTALL_DIR', '/the/install/dir');
    vi.stubEnv('NO_COLOR', '');
    const result = await fetchBrowser({
      command: script(
        'console.log(`NO_COLOR=${process.env.NO_COLOR}`); console.log(`DIR=${process.env.CAMOUFOX_INSTALL_DIR}`)',
      ),
      installed: () => false,
    });
    expect(result?.split('\n')).toEqual(
      expect.arrayContaining(['NO_COLOR=1', 'DIR=/the/install/dir']),
    );
  });

  it('shows the last twelve lines only', async () => {
    const result = await fetchBrowser({
      command: script('for (let i = 1; i <= 30; i++) console.log(`line ${i}`)'),
      installed: () => false,
    });
    const lines = result?.split('\n') ?? [];
    expect(lines).toHaveLength(13);
    expect(lines[1]).toBe('line 19');
    expect(lines.at(-1)).toBe('line 30');
  });

  it('kills the command and rejects when it is aborted', async () => {
    const dir = tempDir();
    const pidFile = join(dir, 'pid');
    const controller = new AbortController();
    const fetching = fetchBrowser({
      command: script(
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ),
      installed: () => false,
      signal: controller.signal,
    });
    const assertion = expect(fetching).rejects.toThrow('shutting down');
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), {
      timeout: 10_000,
    });
    const pid = Number(readFileSync(pidFile, 'utf8'));
    controller.abort(new Error('shutting down'));
    await assertion;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('does not start the command for a signal that is aborted already', async () => {
    const dir = tempDir();
    const marker = join(dir, 'ran');
    await expect(
      fetchBrowser({
        command: script(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
        ),
        installed: () => false,
        signal: AbortSignal.abort(new Error('too late')),
      }),
    ).rejects.toThrow('too late');
    expect(existsSync(marker)).toBe(false);
  });
});
