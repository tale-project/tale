// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { evaluateApprovalGate } from './gate.ts';

const args = {
  organizationId: 'org-policy-proof',
  source: 'connector' as const,
  resourceKey: 'operation-proof',
  connector: 'task',
  action: 'create',
  effect: 'write' as const,
  platformInternal: true,
};

/** The database supplies only organization identity and existing decisions.
 * Policy reads use the real filesystem, parser, validation and cache. */
function database(
  record?: { id: string; status: string; metadata: unknown },
  /** The automation allowances on file, as `<automation>/<connector>.<action>`. */
  allowances: readonly string[] = [],
): {
  sql: Sql;
  mutations: string[];
} {
  const mutations: string[] = [];
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT "slug"')) {
      return Promise.resolve([{ slug: 'policy-proof' }]);
    }
    if (text.includes('FROM app.automation_approval_allowances')) {
      const [, automation, connector, action] = values as string[];
      return Promise.resolve(
        allowances.includes(`${automation}/${connector}.${action}`)
          ? [{ found: 1 }]
          : [],
      );
    }
    if (text.startsWith('SELECT id, status, metadata FROM app.approvals')) {
      return Promise.resolve(record ? [record] : []);
    }
    mutations.push(text);
    return Promise.resolve([{ id: 'approval-proof' }]);
  };
  query.json = (value: unknown): unknown => value;
  query.begin = (callback: (tx: typeof query) => unknown): unknown =>
    callback(query);
  return { sql: query as unknown as Sql, mutations };
}

let root: string;
let policyFile: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-approval-policy-'));
  const governance = path.join(root, 'policy-proof', 'governance');
  await mkdir(governance, { recursive: true });
  policyFile = path.join(governance, 'approval-policy.yml');
  vi.stubEnv('TALE_CONFIG_DIR', root);
  clearOrgConfigCaches();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  clearOrgConfigCaches();
  await rm(root, { recursive: true, force: true });
});

describe('approval policy authority', () => {
  it.each([false, true])(
    'refuses a corrupt policy immediately after an allowed operation (policyOnly=%s) [APV-R4]',
    async (policyOnly) => {
      const db = database();
      await writeFile(policyFile, 'rules: []\n');
      await expect(
        evaluateApprovalGate(db.sql, { ...args, policyOnly }),
      ).resolves.toEqual({ decision: 'allow' });

      // Do not clear caches: a policy change must affect the next write.
      await writeFile(policyFile, 'rules: [\n');
      await expect(
        evaluateApprovalGate(db.sql, {
          ...args,
          resourceKey: 'next-operation',
          policyOnly,
        }),
      ).rejects.toThrow('Governance policy is unavailable or invalid');
      expect(db.mutations).toEqual([]);
    },
  );

  it('refuses a schema-invalid YAML policy instead of reading its valid JSON predecessor [APV-R4]', async () => {
    const db = database();
    await writeFile(
      policyFile,
      'rules:\n  - connector: task\n    decision: bypass\n',
    );
    await writeFile(policyFile.replace(/\.yml$/, '.json'), '{"rules":[]}');

    await expect(evaluateApprovalGate(db.sql, args)).rejects.toThrow(
      'Governance policy is unavailable or invalid',
    );
    expect(db.mutations).toEqual([]);
  });

  it('uses defaults when the policy is absent in an available configuration tree [APV-R1]', async () => {
    const db = database();
    await expect(evaluateApprovalGate(db.sql, args)).resolves.toEqual({
      decision: 'allow',
    });
    expect(db.mutations).toEqual([]);
  });

  it('requires approval for an explicitly restricted internal write [APV-R2]', async () => {
    const db = database();
    await writeFile(
      policyFile,
      'rules:\n  - connector: task\n    decision: require_approval\n',
    );
    await expect(evaluateApprovalGate(db.sql, args)).resolves.toEqual({
      decision: 'needs-approval',
      approvalId: 'approval-proof',
    });
    expect(db.mutations).toHaveLength(1);
    expect(db.mutations[0]).toMatch(/^INSERT INTO app\.approvals/);
  });

  it('refuses an unavailable config root instead of silently allowing an internal write [APV-R4]', async () => {
    const db = database();
    vi.stubEnv('TALE_CONFIG_DIR', path.join(root, 'missing-mount'));
    await expect(evaluateApprovalGate(db.sql, args)).rejects.toThrow(
      'Governance policy is unavailable or invalid',
    );
    expect(db.mutations).toEqual([]);
  });

  it('keeps an existing pending decision while the policy is corrupt [APV-R4]', async () => {
    const db = database({
      id: 'pending-proof',
      status: 'pending',
      metadata: null,
    });
    await writeFile(policyFile, 'rules: [\n');
    await expect(evaluateApprovalGate(db.sql, args)).resolves.toEqual({
      decision: 'needs-approval',
      approvalId: 'pending-proof',
    });
    expect(db.mutations).toEqual([]);
  });
});

describe("an automation's allowance at the gate [APV-R13]", () => {
  const send = {
    organizationId: 'org-policy-proof',
    source: 'automation' as const,
    resourceKey: 'run-1:post',
    connector: 'slack',
    action: 'send_message',
    effect: 'write' as const,
    platformInternal: false,
    automation: 'morning-digest',
  };

  it.each([false, true])(
    'lets the allowed automation write without a person (policyOnly=%s)',
    async (policyOnly) => {
      const db = database(undefined, ['morning-digest/slack.send_message']);
      await expect(
        evaluateApprovalGate(db.sql, { ...send, policyOnly }),
      ).resolves.toEqual({ decision: 'allow' });
      expect(db.mutations).toEqual([]);
    },
  );

  it('still asks for every other automation and every other action', async () => {
    const db = database(undefined, ['morning-digest/slack.send_message']);
    await expect(
      evaluateApprovalGate(db.sql, { ...send, automation: 'weekly-digest' }),
    ).resolves.toMatchObject({ decision: 'needs-approval' });
    await expect(
      evaluateApprovalGate(db.sql, {
        ...send,
        resourceKey: 'run-1:other',
        action: 'add_reaction',
      }),
    ).resolves.toMatchObject({ decision: 'needs-approval' });
  });

  it('yields to a rule that requires a person for the action', async () => {
    await writeFile(
      policyFile,
      'rules:\n  - action: slack.send_message\n    decision: require_approval\n',
    );
    const db = database(undefined, ['morning-digest/slack.send_message']);
    await expect(evaluateApprovalGate(db.sql, send)).resolves.toMatchObject({
      decision: 'needs-approval',
    });
  });

  it('is never read for a call that is not an automation step', async () => {
    const db = database(undefined, ['morning-digest/slack.send_message']);
    await expect(
      evaluateApprovalGate(db.sql, { ...send, source: 'connector' }),
    ).resolves.toMatchObject({ decision: 'needs-approval' });
  });
});
