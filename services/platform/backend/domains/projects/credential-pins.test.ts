// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { carryCredentialPins } from './credential-pins.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(moved: Array<{ projectId: string }>) {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(moved);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('renaming a credential keeps the agents that pin it acting as it [CCRED-R13]', () => {
  it('moves every pin of that connector naming the old name, in any case, to the new one', async () => {
    const { tx, statements } = fakeTx([
      { projectId: 'p-client-a' },
      { projectId: 'p-client-a' },
      { projectId: 'p-dev' },
    ]);
    await expect(
      carryCredentialPins(tx, {
        organizationId: 'org-1',
        connectorSlug: 'forgejo',
        from: 'Client A',
        to: 'Client A (deploy)',
      }),
    ).resolves.toBe(3);
    const [update] = statements;
    expect(update?.text).toContain('UPDATE app.project_agents SET');
    expect(update?.text).toContain(
      'lower(connector_credentials ->> ?) = lower(?)',
    );
    expect(update?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'forgejo',
        'Client A',
        'Client A (deploy)',
      ]),
    );
    // Every project whose agents moved hears of it once.
    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org-1', entity: 'project', entityId: 'p-client-a' },
      { orgId: 'org-1', entity: 'project', entityId: 'p-dev' },
    ]);
  });

  it('writes nothing for a save that keeps the name', async () => {
    const { tx, statements } = fakeTx([]);
    await expect(
      carryCredentialPins(tx, {
        organizationId: 'org-1',
        connectorSlug: 'forgejo',
        from: 'Client A',
        to: 'Client A',
      }),
    ).resolves.toBe(0);
    expect(statements).toEqual([]);
  });
});
