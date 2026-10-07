import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { resolve, split, splitCatalog } from './messages-topics';

describe('splitCatalog', () => {
  it('cuts at the top-level keys, one indentation level less', () => {
    const topics = splitCatalog(
      [
        'chat:',
        '  # The composer.',
        '  send: Send',
        '  nested:',
        "    deep: 'a: b'",
        '',
        'home: # the landing page',
        '  title: Home',
        '',
      ].join('\n'),
    );

    expect(Object.fromEntries(topics)).toEqual({
      chat: "# The composer.\nsend: Send\nnested:\n  deep: 'a: b'\n",
      home: 'title: Home\n',
    });
  });

  it('gives a comment at the margin to what follows it', () => {
    const topics = splitCatalog(
      [
        '# Heads the first topic.',
        'chat:',
        '  send: Send',
        '# Sits inside chat.',
        '  stop: Stop',
        '',
        '# Heads home.',
        '',
        'home:',
        '  title: Home',
      ].join('\n'),
    );

    expect(Object.fromEntries(topics)).toEqual({
      chat: '# Heads the first topic.\nsend: Send\n# Sits inside chat.\nstop: Stop\n',
      home: '# Heads home.\n\ntitle: Home\n',
    });
  });

  it('refuses text it cannot place under a topic', () => {
    expect(() => splitCatalog('stray\nchat:\n  send: Send\n')).toThrow(
      /unexpected top-level line/,
    );
    expect(() => splitCatalog('chat: Send\n')).toThrow(
      /unexpected top-level line/,
    );
  });
});

// The repository fixtures run git; a variable a hook exported (GIT_DIR,
// GIT_INDEX_FILE, …) would point it at the enclosing repository instead.
const inheritedGit = Object.keys(process.env).filter((key) =>
  key.startsWith('GIT_'),
);

beforeAll(() => {
  for (const key of inheritedGit) vi.stubEnv(key, undefined);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

let root: string;
let messages: string;

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_EDITOR: 'true',
      },
    },
  );
}

/** Runs a git command expected to stop on a conflict. */
function gitStops(...args: string[]): void {
  const run = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_EDITOR: 'true',
      },
    },
  );
  expect(run.status, run.stdout + run.stderr).not.toBe(0);
}

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function commit(message: string): void {
  git('add', '--all');
  git('commit', '--quiet', '--message', message);
}

/**
 * main splits its catalogs, then edits `chat.retry`; the branch, written
 * before the split, edits `chat.send` (and `chat.retry` when given) and adds
 * `home.subtitle`.
 */
function divergedAcrossTheSplit(branchRetry = 'Retry'): void {
  write(
    'messages/en.yml',
    'chat:\n  send: Send\n  stop: Stop\n  retry: Retry\nhome:\n  title: Home\n',
  );
  write('messages/global.yml', 'global:\n  brand: Tale\n');
  commit('catalogs');
  git('branch', 'feature');

  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  split(messages);
  commit('split');
  write('messages/en/chat.yml', 'send: Send\nstop: Stop\nretry: Try again\n');
  commit('main edit');

  git('checkout', '--quiet', 'feature');
  write(
    'messages/en.yml',
    `chat:\n  send: Send it\n  stop: Stop\n  retry: ${branchRetry}\nhome:\n  title: Home\n  subtitle: Welcome\n`,
  );
  commit('branch edit');
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'messages-topics-')));
  messages = join(root, 'messages');
  git('init', '--quiet', '--initial-branch', 'main');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('split', () => {
  it('turns each single-file catalog into its topic files', () => {
    write('messages/en.yml', 'chat:\n  send: Send\nhome:\n  title: Home\n');
    write('messages/global.yml', 'global:\n  brand: Tale\n');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    split(messages);

    expect(read('messages/en/chat.yml')).toBe('send: Send\n');
    expect(read('messages/en/home.yml')).toBe('title: Home\n');
    expect(existsSync(join(messages, 'en.yml'))).toBe(false);
    expect(read('messages/global.yml')).toBe('global:\n  brand: Tale\n');
  });
});

describe('resolve', () => {
  it('carries a rebased commit’s edits into the topic files', () => {
    divergedAcrossTheSplit();
    gitStops('rebase', 'main');

    expect(resolve(messages)).toEqual([]);

    expect(read('messages/en/chat.yml')).toBe(
      'send: Send it\nstop: Stop\nretry: Try again\n',
    );
    expect(read('messages/en/home.yml')).toBe(
      'title: Home\nsubtitle: Welcome\n',
    );
    expect(existsSync(join(messages, 'en.yml'))).toBe(false);
    git('add', 'messages');
    git('rebase', '--continue');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('carries a branch’s edits into the topic files when main is merged', () => {
    divergedAcrossTheSplit();
    gitStops('merge', 'main');

    expect(resolve(messages)).toEqual([]);

    expect(read('messages/en/chat.yml')).toBe(
      'send: Send it\nstop: Stop\nretry: Try again\n',
    );
    expect(read('messages/en/home.yml')).toBe(
      'title: Home\nsubtitle: Welcome\n',
    );
    git('add', 'messages');
    git('commit', '--quiet', '--no-edit');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('leaves conflict markers where both sides changed the same line', () => {
    divergedAcrossTheSplit('Resend');
    gitStops('rebase', 'main');

    expect(resolve(messages)).toEqual(['messages/en/chat.yml']);

    expect(read('messages/en/chat.yml')).toMatch(
      /<<<<<<< main\nretry: Try again\n.*=======\nretry: Resend\n>>>>>>> branch/s,
    );
  });

  it('refuses to run outside a rebase or merge', () => {
    write('messages/en.yml', 'chat:\n  send: Send\n');
    commit('catalogs');

    expect(() => resolve(messages)).toThrow(/No rebase or merge/);
  });
});
