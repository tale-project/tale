// @vitest-environment node

/**
 * Owner recovery over the control door (`tale auth reset-owner`): a new
 * password for the owner takes every way in that the old one gave — their
 * sessions and the coding agents they connected — in the same transaction
 * that writes it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  steps: [] as string[],
  transaction: { name: 'tx' },
}));

vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn((password: string) =>
    Promise.resolve(`hashed:${password}`),
  ),
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: vi.fn(
    (_sql: unknown, work: (tx: unknown) => Promise<unknown>) => {
      h.steps.push('begin');
      return work(h.transaction).then((result) => {
        h.steps.push('commit');
        return result;
      });
    },
  ),
}));
vi.mock('../users/service.ts', () => ({
  setCredentialPassword: vi.fn(() => {
    h.steps.push('password');
    return Promise.resolve();
  }),
  recordPasswordChange: vi.fn(() => {
    h.steps.push('anchor');
    return Promise.resolve();
  }),
}));
vi.mock('../../auth/account-security.ts', () => ({
  endAllAccessOf: vi.fn(() => {
    h.steps.push('access');
    return Promise.resolve();
  }),
}));

import { endAllAccessOf } from '../../auth/account-security.ts';
import {
  recordPasswordChange,
  setCredentialPassword,
} from '../users/service.ts';
import { resetOwnerCredentials } from './service.ts';

/** The one read this door makes: the oldest owner of the deployment. */
function sqlWithOwner(): Sql {
  const tag = () =>
    Promise.resolve([{ userId: 'owner-1', email: 'ada@example.test' }]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  return tag as unknown as Sql;
}

beforeEach(() => {
  h.steps.length = 0;
  vi.clearAllMocks();
});

describe('resetting the owner’s password', () => {
  it('writes it, ends their sessions and agents, and anchors the change on the one transaction', async () => {
    const answer = await resetOwnerCredentials(sqlWithOwner(), {
      newPassword: 'Itest-Passw0rd!2',
    });
    expect(answer).toEqual({
      email: 'ada@example.test',
      updated: { email: false, password: true },
    });
    expect(h.steps).toEqual([
      'begin',
      'password',
      'access',
      'anchor',
      'commit',
    ]);
    expect(setCredentialPassword).toHaveBeenCalledWith(
      h.transaction,
      'owner-1',
      'hashed:Itest-Passw0rd!2',
    );
    // The platform's act: no admin is named.
    expect(endAllAccessOf).toHaveBeenCalledExactlyOnceWith(
      h.transaction,
      'owner-1',
    );
    expect(recordPasswordChange).toHaveBeenCalledWith(h.transaction, 'owner-1');
  });

  it('takes nobody’s access away when only the address changes', async () => {
    const tag = (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('?').includes('FROM "member" m')
          ? [{ userId: 'owner-1', email: 'ada@example.test' }]
          : [],
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
    const sql = tag as unknown as Sql;
    const answer = await resetOwnerCredentials(sql, {
      newEmail: 'ada@new.example.test',
    });
    expect(answer.updated).toEqual({ email: true, password: false });
    expect(endAllAccessOf).not.toHaveBeenCalled();
    expect(h.steps).toEqual([]);
  });
});
