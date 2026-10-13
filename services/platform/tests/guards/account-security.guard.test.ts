// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * One door for taking a person's access back [AGCONN-R17]. A statement that
 * ends every session of a person is a security act: the credential, the
 * passkey or the second factor that earned those sessions is gone, and the
 * coding agents the person connected were signed in by the same sign-in. They
 * end together, through `backend/auth/account-security.ts`.
 *
 * So no other module of the backend may spell that statement. A sweep that
 * is not about security — an idle or an expired session removed by its id —
 * names sessions by id and is not what this finds.
 *
 * The same goes for the other end of it: a place that writes a person's
 * password in place of the one they had — the admin's seizure, the owner's
 * reset, the forced rotation — ends their agents in the statement after.
 * (Better Auth's own change ends them in the hook that follows it.)
 */

const BACKEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend',
);
const DOOR = path.join(BACKEND, 'auth/account-security.ts');
const SWEEP = /DELETE\s+FROM\s+"session"\s+WHERE\s+"userId"/i;
const WRITER = /\b(?:setCredentialPassword|forcedResetCredentialPassword)\(/;
const ENDS_AGENTS = /\b(?:endAgentsOf|endAllAccessOf)\(/;
/** Statements after a credential write in which the agents must end. */
const NEXT_LINES = 3;

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('integration')
    ) {
      found.push(full);
    }
  }
  return found;
}

describe('ending every session of a person', () => {
  it('is spelled by the one door that also ends their coding agents', () => {
    expect(SWEEP.test(readFileSync(DOOR, 'utf8'))).toBe(true);
  });

  it('is spelled nowhere else in the backend', () => {
    const spelling = sources(BACKEND)
      .filter((file) => file !== DOOR)
      .filter((file) => SWEEP.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(BACKEND, file));
    expect(spelling).toEqual([]);
  });

  it('is followed by the end of their agents wherever a password is written in place of the one they had', () => {
    const unpaired: string[] = [];
    for (const file of sources(BACKEND)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!WRITER.test(line) || /\bfunction\b/.test(line)) return;
        const following = lines.slice(index, index + 1 + NEXT_LINES).join('\n');
        if (!ENDS_AGENTS.test(following)) {
          unpaired.push(`${path.relative(BACKEND, file)}:${index + 1}`);
        }
      });
    }
    expect(unpaired).toEqual([]);
  });
});
