// The package managers' files for the node's registry caches: what the real
// daemon dispatch writes into a session's home from the two addresses the
// spawner names, byte for byte, and what it leaves alone. The runtime image's
// entrypoint runs as it is, in a scratch root, with `tini`, `setpriv`, `mount`
// and `id` replaced, so it is hermetic on any host.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ENTRYPOINT = resolve(import.meta.dir, '../../entrypoint.sh');

const NPM = 'http://10.200.41.8:4873/';
const PYPI = 'http://10.200.41.9:3141/root/pypi/+simple/';
const MARK =
  '# Written by the Tale sandbox from the registry caches of this node. Delete this line to keep the file as it is.';

const NPMRC = `${MARK}\nregistry=${NPM}\n`;
const BUNFIG = `${MARK}\n[install]\nregistry = "${NPM}"\n`;
const PIP_CONF = `${MARK}\n[global]\nindex-url = ${PYPI}\ntrusted-host = 10.200.41.9:3141\n`;
const UV_TOML = `${MARK}\nallow-insecure-host = ["10.200.41.9:3141"]\n\n[[index]]\nurl = "${PYPI}"\ndefault = true\n`;

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The home the session would have: /agent/.runtime/home in the scratch root. */
  home: string;
  /** What the replaced `setpriv` was asked to run, one line per call. */
  drops: string;
  read(path: string): string | undefined;
  /** Every file under the home, relative to it. */
  files(): string[];
}

/** Run the daemon dispatch once in a scratch root. `before` prepares the home
 * (it exists by then) and is told where it is; `after` reads the outcome while
 * the root still exists. */
function run(
  env: Record<string, string>,
  before: (home: string) => void = () => undefined,
  root = mkdtempSync(join(tmpdir(), 'tale-registry-caches-')),
): { outcome: Outcome; root: string } {
  const bin = join(root, 'bin');
  const home = join(root, 'agent/.runtime/home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  const stub = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub('mount', 'exit 0');
  stub('id', 'echo 0');
  // The drop to the session user: note it, skip its options, run what follows.
  stub(
    'setpriv',
    `echo "$*" >> "${root}/drops"\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"`,
  );
  stub('tini', 'echo "tini $*"');
  before(home);
  const script = join(root, 'entrypoint.sh');
  writeFileSync(
    script,
    readFileSync(ENTRYPOINT, 'utf8')
      .replaceAll('/agent/', `${root}/agent/`)
      .replace('_MOUNT=/usr/bin/mount', `_MOUNT=${bin}/mount`),
  );
  const r = spawnSync('sh', [script, 'daemon'], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...env },
  });
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name)).map((name) => join(entry.name, name))
        : [entry.name],
    );
  return {
    root,
    outcome: {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      home,
      drops: existsSync(join(root, 'drops'))
        ? readFileSync(join(root, 'drops'), 'utf8')
        : '',
      read: (path) =>
        existsSync(join(home, path))
          ? readFileSync(join(home, path), 'utf8')
          : undefined,
      files: () => walk(home).toSorted(),
    },
  };
}

/** One start, then `check` on what it left; the root is always removed. */
function start(
  env: Record<string, string>,
  check: (outcome: Outcome) => void,
  before?: (home: string) => void,
): void {
  const { outcome, root } = run(env, before);
  try {
    check(outcome);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const RUNNERD = 'tini -g -- node /usr/local/lib/tale/runnerd.mjs\n';

describe('with no cache named', () => {
  test('nothing is written, said or asked of the session user, and runnerd starts as before', () => {
    start({}, (o) => {
      expect(o.status).toBe(0);
      expect(o.stdout).toBe(RUNNERD);
      expect(o.stderr).toBe('');
      expect(o.files()).toEqual([]);
      expect(o.drops).toBe('');
    });
  });

  test('blank values name nothing either', () => {
    start(
      { TALE_REGISTRY_CACHE_NPM: '', TALE_REGISTRY_CACHE_PYPI: '' },
      (o) => {
        expect(o.stderr).toBe('');
        expect(o.files()).toEqual([]);
      },
    );
  });
});

describe('with the caches named', () => {
  const both = { TALE_REGISTRY_CACHE_NPM: NPM, TALE_REGISTRY_CACHE_PYPI: PYPI };

  test('npm, bun, pip and uv are each given their file, byte for byte, before runnerd starts', () => {
    start(both, (o) => {
      expect(o.status).toBe(0);
      expect(o.stderr).toBe('');
      expect(o.stdout).toBe(RUNNERD);
      expect(o.files()).toEqual([
        '.bunfig.toml',
        '.config/pip/pip.conf',
        '.config/uv/uv.toml',
        '.npmrc',
      ]);
      expect(o.read('.npmrc')).toBe(NPMRC);
      expect(o.read('.bunfig.toml')).toBe(BUNFIG);
      expect(o.read('.config/pip/pip.conf')).toBe(PIP_CONF);
      expect(o.read('.config/uv/uv.toml')).toBe(UV_TOML);
    });
  });

  test('the files are readable config, and nothing is left behind from the write', () => {
    start(both, (o) => {
      for (const name of ['.npmrc', '.bunfig.toml', '.config/pip/pip.conf']) {
        expect(statSync(join(o.home, name)).mode & 0o777).toBe(0o644);
      }
      expect(
        o.files().filter((name) => name.includes('.registry-cache')),
      ).toEqual([]);
    });
  });

  test('a cache alone writes the files of its own package managers', () => {
    start({ TALE_REGISTRY_CACHE_NPM: NPM }, (o) => {
      expect(o.files()).toEqual(['.bunfig.toml', '.npmrc']);
    });
    start({ TALE_REGISTRY_CACHE_PYPI: PYPI }, (o) => {
      expect(o.files()).toEqual(['.config/pip/pip.conf', '.config/uv/uv.toml']);
    });
  });

  test('an index on the default port trusts its bare host', () => {
    start({ TALE_REGISTRY_CACHE_PYPI: 'http://10.200.41.9/simple/' }, (o) => {
      expect(o.read('.config/pip/pip.conf')).toBe(
        `${MARK}\n[global]\nindex-url = http://10.200.41.9/simple/\ntrusted-host = 10.200.41.9\n`,
      );
      expect(o.read('.config/uv/uv.toml')).toContain(
        'allow-insecure-host = ["10.200.41.9"]',
      );
    });
  });

  test('they are written as the session user, whom the entrypoint dropped to', () => {
    start({ ...both, TALE_SHM_SIZE: '512m', TALE_DROP_UID: '10001' }, (o) => {
      expect(o.status).toBe(0);
      // The skeleton, the cache files and runnerd's own start each drop.
      expect(o.drops).toContain('--reuid 10001');
      expect(o.drops).toContain('-- /bin/sh -c');
      expect(o.drops).toContain(
        `registry-cache-files ${o.home} ${NPM} ${PYPI}`,
      );
      expect(o.read('.npmrc')).toBe(NPMRC);
    });
  });

  test('a start that finds the files again leaves them as they are, and a moved cache is followed', () => {
    const first = run(both);
    try {
      expect(first.outcome.read('.npmrc')).toBe(NPMRC);
      const again = run(both, () => undefined, first.root);
      expect(again.outcome.read('.npmrc')).toBe(NPMRC);
      expect(again.outcome.read('.config/uv/uv.toml')).toBe(UV_TOML);
      const moved = run(
        {
          TALE_REGISTRY_CACHE_NPM: 'http://10.200.41.18:4873/',
          TALE_REGISTRY_CACHE_PYPI:
            'http://10.200.41.19:3141/root/pypi/+simple/',
        },
        () => undefined,
        first.root,
      );
      expect(moved.outcome.read('.npmrc')).toBe(
        `${MARK}\nregistry=http://10.200.41.18:4873/\n`,
      );
      expect(moved.outcome.read('.config/pip/pip.conf')).toContain(
        'trusted-host = 10.200.41.19:3141',
      );
      expect(moved.outcome.files()).toEqual(first.outcome.files());
    } finally {
      rmSync(first.root, { recursive: true, force: true });
    }
  });
});

describe("a session owner's own files", () => {
  const both = { TALE_REGISTRY_CACHE_NPM: NPM, TALE_REGISTRY_CACHE_PYPI: PYPI };
  const OWN = '//registry.example.test/:_authToken=not-a-real-token\n';

  test('are never replaced, and the other files are still written', () => {
    start(
      both,
      (o) => {
        expect(o.stderr).toBe('');
        expect(o.read('.npmrc')).toBe(OWN);
        expect(o.read('.bunfig.toml')).toBe(BUNFIG);
        expect(o.read('.config/pip/pip.conf')).toBe(PIP_CONF);
      },
      (home) => writeFileSync(join(home, '.npmrc'), OWN),
    );
  });

  test('stay when the owner took the marker out of a file the sandbox wrote', () => {
    start(
      both,
      (o) => {
        expect(o.read('.config/pip/pip.conf')).toBe(
          '[global]\nindex-url = https://pypi.example.test/simple/\n',
        );
      },
      (home) => {
        mkdirSync(join(home, '.config/pip'), { recursive: true });
        writeFileSync(
          join(home, '.config/pip/pip.conf'),
          '[global]\nindex-url = https://pypi.example.test/simple/\n',
        );
      },
    );
  });

  test('stay when no cache is named, as does everything else a session wrote', () => {
    start(
      {},
      (o) => {
        expect(o.read('.npmrc')).toBe(OWN);
        expect(o.read('.bunfig.toml')).toBe('[install]\nregistry = "x"\n');
        expect(o.stderr).toBe('');
      },
      (home) => {
        writeFileSync(join(home, '.npmrc'), OWN);
        writeFileSync(
          join(home, '.bunfig.toml'),
          '[install]\nregistry = "x"\n',
        );
      },
    );
  });

  test('a symbolic link in their place is not followed or replaced', () => {
    const outside = mkdtempSync(join(tmpdir(), 'tale-registry-caches-out-'));
    try {
      const target = join(outside, 'target');
      writeFileSync(target, 'untouched\n');
      start(
        both,
        (o) => {
          expect(readFileSync(target, 'utf8')).toBe('untouched\n');
          expect(lstatSync(join(o.home, '.npmrc')).isSymbolicLink()).toBe(true);
          expect(o.read('.bunfig.toml')).toBe(BUNFIG);
        },
        (home) => symlinkSync(target, join(home, '.npmrc')),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a symbolic link the sandbox had made is replaced by a file, never written through', () => {
    const outside = mkdtempSync(join(tmpdir(), 'tale-registry-caches-out-'));
    try {
      const target = join(outside, 'target');
      writeFileSync(target, `${MARK}\nregistry=http://10.0.0.1/\n`);
      start(
        { TALE_REGISTRY_CACHE_NPM: NPM },
        (o) => {
          expect(readFileSync(target, 'utf8')).toBe(
            `${MARK}\nregistry=http://10.0.0.1/\n`,
          );
          expect(lstatSync(join(o.home, '.npmrc')).isSymbolicLink()).toBe(
            false,
          );
          expect(o.read('.npmrc')).toBe(NPMRC);
        },
        (home) => symlinkSync(target, join(home, '.npmrc')),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('a cache that is no longer named', () => {
  test('takes its files with it, and only the ones the sandbox wrote', () => {
    const first = run({
      TALE_REGISTRY_CACHE_NPM: NPM,
      TALE_REGISTRY_CACHE_PYPI: PYPI,
    });
    try {
      writeFileSync(join(first.outcome.home, '.npmrc'), 'registry=mine\n');
      const off = run({}, () => undefined, first.root);
      expect(off.outcome.status).toBe(0);
      expect(off.outcome.stderr).toBe('');
      // The owner's .npmrc stays; the three the sandbox wrote are gone.
      expect(off.outcome.files()).toEqual(['.npmrc']);
      expect(off.outcome.read('.npmrc')).toBe('registry=mine\n');
    } finally {
      rmSync(first.root, { recursive: true, force: true });
    }
  });

  test('one cache dropped from the settings takes only its own files', () => {
    const first = run({
      TALE_REGISTRY_CACHE_NPM: NPM,
      TALE_REGISTRY_CACHE_PYPI: PYPI,
    });
    try {
      const pypiOnly = run(
        { TALE_REGISTRY_CACHE_PYPI: PYPI },
        () => undefined,
        first.root,
      );
      expect(pypiOnly.outcome.files()).toEqual([
        '.config/pip/pip.conf',
        '.config/uv/uv.toml',
      ]);
    } finally {
      rmSync(first.root, { recursive: true, force: true });
    }
  });
});

describe('a value that is not a plain http URL', () => {
  test.each([
    ['https://10.200.41.8:4873/'],
    ['10.200.41.8:4873'],
    ['http://10.200.41.8:4873/"\nregistry=http://evil.test/'],
    ['http://10.200.41.8:4873/a b'],
    ['http://10.200.41.8:4873/$(reboot)'],
    ['http://10.200.41.8:4873/a;b'],
    ['http://10.200.41.8:4873/a#b'],
    ["http://10.200.41.8:4873/a'b"],
  ])('%j is ignored with a warning, and writes nothing of it', (bad) => {
    start(
      { TALE_REGISTRY_CACHE_NPM: bad, TALE_REGISTRY_CACHE_PYPI: PYPI },
      (o) => {
        expect(o.status).toBe(0);
        expect(o.stderr).toContain('not a plain http URL');
        expect(o.files()).toEqual([
          '.config/pip/pip.conf',
          '.config/uv/uv.toml',
        ]);
        expect(o.stdout).toBe(RUNNERD);
      },
    );
  });
});

describe('a file that cannot be written', () => {
  test('is a warning, and the other files and the session go on', () => {
    start(
      { TALE_REGISTRY_CACHE_NPM: NPM, TALE_REGISTRY_CACHE_PYPI: PYPI },
      (o) => {
        expect(o.status).toBe(0);
        expect(o.stdout).toBe(RUNNERD);
        expect(o.stderr).toContain('could not write');
        expect(o.stderr).toContain('.config/pip/pip.conf');
        expect(o.read('.npmrc')).toBe(NPMRC);
        expect(o.read('.bunfig.toml')).toBe(BUNFIG);
      },
      // `.config` is a file: nothing can be made under it.
      (home) => {
        mkdirSync(dirname(join(home, '.config')), { recursive: true });
        writeFileSync(join(home, '.config'), 'in the way\n');
      },
    );
  });
});
