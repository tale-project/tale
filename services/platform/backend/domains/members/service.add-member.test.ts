import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { addMember } from './service.ts';

/**
 * An API key's own identity — the `"user"` row a key authenticates as — is
 * never a person. Made a member, it would act as one: past the project its
 * key was confined to, and spending as a person. The members door refuses
 * it before anything is written.
 */

const ORG_ID = 'org-under-test';
const ADMIN_ID = 'user-admin';

function recordingTx(keyIdentities: string[]): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.includes('FROM "member"')) {
      const userId = values[1];
      return Promise.resolve(
        userId === ADMIN_ID
          ? [
              {
                id: 'member-admin',
                organizationId: ORG_ID,
                userId: ADMIN_ID,
                role: 'admin',
              },
            ]
          : [],
      );
    }
    if (text.includes('FROM app.api_key_owners')) {
      return Promise.resolve(
        keyIdentities.includes(String(values[0])) ? [{ id: 'key-1' }] : [],
      );
    }
    return Promise.reject(new Error(`unexpected statement: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for a transaction
  return { tx: tag as unknown as TransactionSql, statements };
}

describe('addMember', () => {
  it('refuses to make an API key’s own identity a member [APIKEY-R4]', async () => {
    const { tx, statements } = recordingTx(['key-identity']);
    await expect(
      addMember(
        tx,
        { userId: ADMIN_ID },
        { organizationId: ORG_ID, userId: 'key-identity', role: 'admin' },
      ),
    ).rejects.toMatchObject({ code: 'MEMBER_ADD_FORBIDDEN', status: 403 });
    expect(statements.some((text) => text.startsWith('INSERT'))).toBe(false);
  });
});
