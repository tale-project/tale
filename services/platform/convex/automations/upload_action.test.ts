// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConvexError } from 'convex/values';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

import { DOC_EXAMPLE } from '../../lib/engine/api/docs';

// Identity-mock the Convex builders so the action is a plain object whose
// handler runs against a fake ctx (same pattern as skills/file_actions.test.ts).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// The auth gate is V8 + Better Auth — replace it with a configurable stub.
let authRole = 'admin';
vi.mock('../lib/auth/require_org_admin_or_developer', () => ({
  requireOrgAdminOrDeveloper: async () => ({
    orgId: 'org_1',
    orgSlug: 'acme',
    userId: 'user_admin',
    email: 'admin@acme.test',
    member: { role: authRole },
  }),
}));

// oxlint-disable-next-line typescript/no-explicit-any -- builders mocked to identity (third-party gap per AGENTS.md)
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

async function loadUpload(): Promise<Handler> {
  const mod = (await import('./upload_action')) as unknown as Record<
    string,
    Handler
  >;
  const handler = mod.uploadAutomation;
  if (handler === undefined) throw new Error('uploadAutomation not exported');
  return handler;
}

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  authRole = 'admin';
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-upload-'));
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

const VALID_DOC = stringify(DOC_EXAMPLE.automation);
const SKILL_MD =
  '---\nname: triage\ndescription: Sorts the inbox\n---\n\n# Triage\n';

/** A fake action ctx: `_storage` blobs by id + a runMutation that dispatches
 * on argument shape (the generated `internal` refs are proxies, so reference
 * identity is not a reliable dispatch key under the mocked builders). */
function fakeCtx(options?: {
  blobs?: Record<string, Uint8Array>;
  intentValid?: boolean;
  storeSaveError?: string;
}) {
  const calls = {
    storeSave: [] as Record<string, unknown>[],
    bindProject: [] as Record<string, unknown>[],
    intentVerified: 0,
    intentDeleted: 0,
    blobDeleted: [] as string[],
    storageGet: 0,
  };
  const blobs = options?.blobs ?? {};
  const ctx = {
    storage: {
      get: async (id: string) => {
        calls.storageGet += 1;
        const bytes = blobs[id];
        if (bytes === undefined) return null;
        return {
          size: bytes.byteLength,
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
        };
      },
      delete: async (id: string) => {
        calls.blobDeleted.push(id);
      },
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if ('automationName' in args) {
        calls.bindProject.push(args);
        return null;
      }
      if ('automation' in args) {
        calls.storeSave.push(args);
        if (options?.storeSaveError !== undefined) {
          throw new Error(options.storeSaveError);
        }
        return { name: 'order-report', version: calls.storeSave.length };
      }
      if ('organizationId' in args && 'storageId' in args) {
        calls.intentVerified += 1;
        return options?.intentValid ?? true;
      }
      calls.intentDeleted += 1;
      return null;
    },
    // The skills viewer-context lookup is a V8 query — absent here, so the
    // handler falls back to deriving org-admin from the stubbed member role.
    runQuery: async () => null,
  };
  return { ctx, calls };
}

async function buildZip(
  files: Record<string, string | Uint8Array>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      return String(data.code);
    }
  }
  return undefined;
}

async function expectRefusal(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(errorCode(err)).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} refusal`);
}

async function seedOrgSkill(slug: string, files: Record<string, string>) {
  const dir = path.join(configRoot, 'acme', 'skills', slug);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content, 'utf-8');
  }
}

describe('the text lane', () => {
  it('saves a draft and reports no skills', async () => {
    const upload = await loadUpload();
    const { ctx, calls } = fakeCtx();
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      files: [{ name: 'workflow.yml', content: VALID_DOC }],
    });
    expect(result).toMatchObject({
      ok: true,
      name: 'order-report',
      version: 1,
      skills: [],
    });
    expect(calls.storeSave).toHaveLength(1);
  });

  it('refuses a manifest that declares skills', async () => {
    const upload = await loadUpload();
    const { ctx } = fakeCtx();
    await expectRefusal(
      upload.handler(ctx, {
        organizationId: 'org_1',
        files: [
          { name: 'workflow.yml', content: VALID_DOC },
          { name: 'automation.yml', content: 'name: X\nskills: [triage]\n' },
        ],
      }),
      'PACK_SKILLS_MISMATCH',
    );
  });

  it('refuses a project-scoped pack installed org-wide', async () => {
    const upload = await loadUpload();
    const { ctx, calls } = fakeCtx();
    await expectRefusal(
      upload.handler(ctx, {
        organizationId: 'org_1',
        files: [
          { name: 'workflow.yml', content: VALID_DOC },
          { name: 'automation.yml', content: 'name: X\nscope: project\n' },
        ],
      }),
      'AUTOMATION_PROJECT_REQUIRED',
    );
    expect(calls.storeSave).toHaveLength(0);
  });

  it('saves a project-scoped pack into the chosen project', async () => {
    const upload = await loadUpload();
    const { ctx, calls } = fakeCtx();
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      files: [
        { name: 'workflow.yml', content: VALID_DOC },
        { name: 'automation.yml', content: 'name: X\nscope: project\n' },
      ],
      projectId: 'project_1',
    });
    expect(result).toMatchObject({ ok: true, name: 'order-report' });
    expect(calls.storeSave[0]).toMatchObject({ projectId: 'project_1' });
    expect(calls.bindProject[0]).toMatchObject({
      automationName: 'order-report',
      projectId: 'project_1',
    });
  });

  it('refuses both lanes and neither lane', async () => {
    const upload = await loadUpload();
    const { ctx } = fakeCtx();
    await expectRefusal(
      upload.handler(ctx, { organizationId: 'org_1' }),
      'AUTOMATION_UPLOAD_INVALID',
    );
    await expectRefusal(
      upload.handler(ctx, {
        organizationId: 'org_1',
        files: [{ name: 'workflow.yml', content: VALID_DOC }],
        storageId: 'blob_1',
      }),
      'AUTOMATION_UPLOAD_INVALID',
    );
  });
});

describe('the zip lane', () => {
  it('refuses a storageId no intent covers, before reading storage', async () => {
    const upload = await loadUpload();
    const { ctx, calls } = fakeCtx({ intentValid: false });
    await expectRefusal(
      upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
      'STORAGE_NOT_OWNED',
    );
    expect(calls.storageGet).toBe(0);
    expect(calls.blobDeleted).toEqual(['blob_1']);
    expect(calls.intentDeleted).toBe(1);
  });

  it('refuses a missing blob and still cleans up', async () => {
    const upload = await loadUpload();
    const { ctx, calls } = fakeCtx();
    await expectRefusal(
      upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
      'STORAGE_NOT_FOUND',
    );
    expect(calls.intentDeleted).toBe(1);
  });

  it('saves a zip without skills and cleans up blob + intent', async () => {
    const upload = await loadUpload();
    const bytes = await buildZip({ 'workflow.yml': VALID_DOC });
    const { ctx, calls } = fakeCtx({ blobs: { blob_1: bytes } });
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      storageId: 'blob_1',
    });
    expect(result).toMatchObject({
      ok: true,
      name: 'order-report',
      skills: [],
    });
    expect(calls.storeSave[0]).toMatchObject({
      organizationId: 'org_1',
      actor: 'user_admin',
      message: 'Uploaded package (workflow.yml)',
    });
    expect(calls.blobDeleted).toEqual(['blob_1']);
    expect(calls.intentDeleted).toBe(1);
  });

  it('refuses a skills declaration mismatch in either direction', async () => {
    const upload = await loadUpload();
    const cases: Record<string, string>[] = [
      // declared but not carried
      {
        'workflow.yml': VALID_DOC,
        'automation.yml': 'name: X\nskills: [ghost]\n',
      },
      // carried but not declared
      {
        'workflow.yml': VALID_DOC,
        'automation.yml': 'name: X\n',
        'skills/triage/SKILL.md': SKILL_MD,
      },
      // carried with no manifest at all
      { 'workflow.yml': VALID_DOC, 'skills/triage/SKILL.md': SKILL_MD },
    ];
    for (const files of cases) {
      const { ctx, calls } = fakeCtx({
        blobs: { blob_1: await buildZip(files) },
      });
      await expectRefusal(
        upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
        'PACK_SKILLS_MISMATCH',
      );
      expect(calls.storeSave).toHaveLength(0);
    }
  });

  it('refuses a project-scoped zip installed org-wide, before touching skills', async () => {
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nscope: project\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx, calls } = fakeCtx({ blobs: { blob_1: bytes } });
    await expectRefusal(
      upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
      'AUTOMATION_PROJECT_REQUIRED',
    );
    expect(calls.storeSave).toHaveLength(0);
    await expect(
      readFile(path.join(configRoot, 'acme', 'skills', 'triage', 'SKILL.md')),
    ).rejects.toThrow();
  });

  it('installs a carried skill and reports it created', async () => {
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
      'skills/triage/scripts/run.py': 'print("hi")\n',
    });
    const { ctx } = fakeCtx({ blobs: { blob_1: bytes } });
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      storageId: 'blob_1',
    });
    expect(result).toMatchObject({
      ok: true,
      skills: [{ slug: 'triage', action: 'created' }],
    });
    const installed = path.join(configRoot, 'acme', 'skills', 'triage');
    expect(await readFile(path.join(installed, 'SKILL.md'), 'utf-8')).toBe(
      SKILL_MD,
    );
    expect(
      await readFile(path.join(installed, 'scripts', 'run.py'), 'utf-8'),
    ).toBe('print("hi")\n');
  });

  it('reports a byte-identical carried skill unchanged, without history', async () => {
    await seedOrgSkill('triage', { 'SKILL.md': SKILL_MD });
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx } = fakeCtx({ blobs: { blob_1: bytes } });
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      storageId: 'blob_1',
    });
    expect(result).toMatchObject({
      ok: true,
      skills: [{ slug: 'triage', action: 'unchanged' }],
    });
    await expect(
      readdir(path.join(configRoot, 'acme', 'skills', '.history')),
    ).rejects.toThrow();
  });

  it('asks for confirmation on a differing skill and writes nothing', async () => {
    await seedOrgSkill('triage', {
      'SKILL.md':
        '---\nname: triage\ndescription: The org version\n---\nOld.\n',
    });
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx, calls } = fakeCtx({ blobs: { blob_1: bytes } });
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      storageId: 'blob_1',
    });
    expect(result).toEqual({
      ok: false,
      status: 'needs_confirm',
      skillConflicts: ['triage'],
    });
    expect(calls.storeSave).toHaveLength(0);
    expect(
      await readFile(
        path.join(configRoot, 'acme', 'skills', 'triage', 'SKILL.md'),
        'utf-8',
      ),
    ).toContain('The org version');
    // The blob is single-use either way.
    expect(calls.blobDeleted).toEqual(['blob_1']);
  });

  it('replaces a confirmed skill, keeps history, drops stale assets', async () => {
    await seedOrgSkill('triage', {
      'SKILL.md':
        '---\nname: triage\ndescription: The org version\n---\nOld.\n',
      'stale.txt': 'left behind',
    });
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx } = fakeCtx({ blobs: { blob_1: bytes } });
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      storageId: 'blob_1',
      // The extraneous entry is ignored.
      overwriteSkills: ['triage', 'not-carried'],
    });
    expect(result).toMatchObject({
      ok: true,
      skills: [{ slug: 'triage', action: 'replaced' }],
    });
    const dir = path.join(configRoot, 'acme', 'skills', 'triage');
    expect(await readFile(path.join(dir, 'SKILL.md'), 'utf-8')).toBe(SKILL_MD);
    await expect(readFile(path.join(dir, 'stale.txt'))).rejects.toThrow();
    const history = await readdir(
      path.join(configRoot, 'acme', 'skills', '.history', 'triage'),
    );
    expect(history).toHaveLength(1);
  });

  it('refuses when the caller may not edit the existing skill', async () => {
    authRole = 'developer';
    await seedOrgSkill('triage', {
      'SKILL.md':
        '---\nname: triage\ndescription: Owned\nvisibility: org\n---\nOld.\n',
    });
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx, calls } = fakeCtx({ blobs: { blob_1: bytes } });
    await expectRefusal(
      upload.handler(ctx, {
        organizationId: 'org_1',
        storageId: 'blob_1',
        overwriteSkills: ['triage'],
      }),
      'SKILL_CONFLICT_FORBIDDEN',
    );
    expect(calls.storeSave).toHaveLength(0);
  });

  it('refuses an invalid document without touching skills', async () => {
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml':
        'name: bad\nnodes:\n  - id: x\n    type: no.such_action\n',
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx, calls } = fakeCtx({ blobs: { blob_1: bytes } });
    await expectRefusal(
      upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
      'AUTOMATION_UPLOAD_REJECTED',
    );
    expect(calls.storeSave).toHaveLength(0);
    await expect(
      readFile(path.join(configRoot, 'acme', 'skills', 'triage', 'SKILL.md')),
    ).rejects.toThrow();
  });

  it('warns about a referenced skill that exists nowhere', async () => {
    const doc = {
      name: 'demo',
      nodes: [
        {
          id: 'helper',
          type: 'agent',
          prompt: 'do the thing',
          model: 'anthropic/claude-haiku-4-5',
          skills: ['ghost', 'triage', '{{ inputs.dynamic }}'],
        },
      ],
    };
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': stringify(doc),
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx } = fakeCtx({ blobs: { blob_1: bytes } });
    const result = await upload.handler(ctx, {
      organizationId: 'org_1',
      storageId: 'blob_1',
    });
    expect(result.ok).toBe(true);
    const warnings = (result.warnings as string[]).filter((line) =>
      line.includes('SKILL_NOT_FOUND'),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"ghost"');
  });

  it('cleans up even when the store refuses the save', async () => {
    const upload = await loadUpload();
    const bytes = await buildZip({
      'workflow.yml': VALID_DOC,
      'automation.yml': 'name: X\nskills: [triage]\n',
      'skills/triage/SKILL.md': SKILL_MD,
    });
    const { ctx, calls } = fakeCtx({
      blobs: { blob_1: bytes },
      storeSaveError: 'name pinned to another project',
    });
    await expect(
      upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
    ).rejects.toThrow('name pinned');
    // Skills landed before the save — benign, and the next attempt reports
    // them unchanged.
    expect(
      await readFile(
        path.join(configRoot, 'acme', 'skills', 'triage', 'SKILL.md'),
        'utf-8',
      ),
    ).toBe(SKILL_MD);
    expect(calls.blobDeleted).toEqual(['blob_1']);
    expect(calls.intentDeleted).toBe(1);
  });

  it('refuses an oversized compressed blob before parsing', async () => {
    const upload = await loadUpload();
    const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    const { ctx } = fakeCtx({ blobs: { blob_1: bytes } });
    await expectRefusal(
      upload.handler(ctx, { organizationId: 'org_1', storageId: 'blob_1' }),
      'PACK_TOO_LARGE',
    );
  });
});
