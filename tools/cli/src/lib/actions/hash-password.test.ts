import { describe, expect, test } from 'bun:test';

import { verifyPassword } from 'better-auth/crypto';

import { hashPolicyPassword, readPasswordInput } from './hash-password';

const password = 'Synthetic!Break-Glass1';

async function* chunks(...values: (string | Uint8Array)[]) {
  for (const value of values) yield value;
}
async function refusal(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe('password input for hashing', () => {
  const umlaut = Buffer.from('Synthetic-ä-Glass-1\n');
  const split = umlaut.indexOf(Buffer.from('ä')) + 1;
  test.each([
    ['exact', [password], password],
    ['echo line ending', [`${password}\n`], password],
    ['CRLF line ending', [`${password}\r\n`], password],
    [
      'a character split across chunks',
      [umlaut.subarray(0, split), umlaut.subarray(split)],
      'Synthetic-ä-Glass-1',
    ],
  ])('reads %s input', async (_name, values, expected) => {
    expect(await readPasswordInput(chunks(...values))).toBe(expected);
  });

  test.each([
    ['empty', [''], 'No password was provided.'],
    ['line ending only', ['\n'], 'No password was provided.'],
    ['two line endings', [`${password}\n\n`], 'control characters'],
    ['embedded line ending', ['Synthetic\nBreak-1'], 'control characters'],
    ['tab', [`${password}\t`], 'control characters'],
    ['invalid UTF-8', [Buffer.from([0xc3, 0x28])], 'not valid UTF-8'],
    ['over 128 characters', [`${'Aa1!'.repeat(33)}`], '128 characters'],
    ['over 4 KiB', ['A'.repeat(4097)], 'exceeds 4 KiB'],
  ])('refuses %s without reflecting it', async (_name, values, message) => {
    const error = await refusal(readPasswordInput(chunks(...values)));
    expect(error.message).toContain(message);
    expect(JSON.stringify(error)).not.toContain('Synthetic');
  });

  test('stops reading once the bound is exceeded', async () => {
    let read = 0;
    async function* source() {
      read++;
      yield Buffer.alloc(4097, 65);
      read++;
      yield password;
    }
    await refusal(readPasswordInput(source()));
    expect(read).toBe(1);
  });

  test('stream failures do not reflect their cause', async () => {
    async function* source() {
      yield 'Synthetic';
      throw new Error(password);
    }
    const error = await refusal(readPasswordInput(source()));
    expect(error.message).toBe('Unable to read the password from stdin.');
    expect(JSON.stringify(error)).not.toContain(password);
  });
});

describe('policy password hashing', () => {
  test('hashes a policy-compliant password for native verification', async () => {
    const hash = await hashPolicyPassword(password);
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await verifyPassword({ hash, password })).toBe(true);
  });

  test.each([
    ['Short-1a', 'length'],
    ['synthetic-break-glass-1', 'uppercase'],
    ['SYNTHETIC-BREAK-GLASS-1', 'lowercase'],
    ['Synthetic-Break-Glass', 'number'],
    ['SyntheticBreakGlass1', 'specialChar'],
  ])('refuses %s by the failed rule only', async (weak, rule) => {
    const error = await refusal(hashPolicyPassword(weak));
    expect(error.message).toContain(`failed: ${rule}`);
    expect(JSON.stringify(error)).not.toContain(weak);
  });
});
