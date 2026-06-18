import { beforeEach, describe, expect, test } from 'bun:test';

import { resolveOutputMode, setActiveOutputMode } from './output-mode';
import {
  confirm,
  confirmChoice,
  input,
  NonInteractiveError,
  password,
  select,
} from './prompt';

// `bun test` does not run on a TTY, so `isInteractive()` is naturally false —
// which is exactly the non-interactive shell case we want to verify.
beforeEach(() => {
  setActiveOutputMode(resolveOutputMode({}, {}, { isTTY: false }));
});

/** Resolve to the error a rejecting promise threw (or undefined if it resolved). */
async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('prompts throw (never hang) in a non-interactive shell', () => {
  test('confirm', async () => {
    expect(await caught(confirm({ message: 'ok?' }))).toBeInstanceOf(
      NonInteractiveError,
    );
  });
  test('input', async () => {
    expect(await caught(input({ message: 'name?' }))).toBeInstanceOf(
      NonInteractiveError,
    );
  });
  test('select', async () => {
    expect(
      await caught(
        select({ message: 'pick', choices: [{ name: 'a', value: 'a' }] }),
      ),
    ).toBeInstanceOf(NonInteractiveError);
  });
  test('password throws even when --yes would otherwise apply', async () => {
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}, { isTTY: false }));
    expect(await caught(password({ message: 'secret?' }))).toBeInstanceOf(
      NonInteractiveError,
    );
  });
});

describe('--yes resolves defaults without prompting', () => {
  beforeEach(() => {
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}, { isTTY: false }));
  });

  test('confirm resolves to its default (or true)', async () => {
    expect(await confirm({ message: 'ok?', default: false })).toBe(false);
    expect(await confirm({ message: 'ok?' })).toBe(true);
  });
  test('input resolves to its default', async () => {
    expect(await input({ message: 'name?', default: 'tale' })).toBe('tale');
  });
  test('select resolves to its default', async () => {
    expect(
      await select({
        message: 'pick',
        choices: [
          { name: 'a', value: 'a' },
          { name: 'b', value: 'b' },
        ],
        default: 'b',
      }),
    ).toBe('b');
  });
  test('confirmChoice resolves to accept-all', async () => {
    expect(await confirmChoice({ message: 'step?' })).toBe('accept-all');
  });
});
