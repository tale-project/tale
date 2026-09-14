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
function database(record?: { id: string; status: string; metadata: unknown }): {
  sql: Sql;
  mutations: string[];
} {
  const mutations: string[] = [];
  const query = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT "slug"')) {
      return Promise.resolve([{ slug: 'policy-proof' }]);
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
    'refuses a corrupt policy immediately after an allowed operation (policyOnly=%s)',
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

  it('refuses a schema-invalid YAML policy instead of reading its valid JSON predecessor', async () => {
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

  it('uses defaults when the policy is absent in an available configuration tree', async () => {
    const db = database();
    await expect(evaluateApprovalGate(db.sql, args)).resolves.toEqual({
      decision: 'allow',
    });
    expect(db.mutations).toEqual([]);
  });

  it('requires approval for an explicitly restricted internal write', async () => {
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

  it('refuses an unavailable config root instead of silently allowing an internal write', async () => {
    const db = database();
    vi.stubEnv('TALE_CONFIG_DIR', path.join(root, 'missing-mount'));
    await expect(evaluateApprovalGate(db.sql, args)).rejects.toThrow(
      'Governance policy is unavailable or invalid',
    );
    expect(db.mutations).toEqual([]);
  });

  it('keeps an existing pending decision while the policy is corrupt', async () => {
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
