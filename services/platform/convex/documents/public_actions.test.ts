import { describe, expect, it, vi } from 'vitest';

import { ensureProjectTextDocument } from './public_actions';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  internal: {
    folders: {
      internal_mutations: {
        getOrCreateProjectRootFolder: 'getOrCreateProjectRootFolder',
      },
    },
    documents: {
      internal_actions: { storeRawContent: 'storeRawContent' },
      internal_mutations: {
        upsertDocumentByExternalId: 'upsertDocumentByExternalId',
      },
    },
    skills: {
      file_actions: {
        readSkillAssetForExecution: 'readSkillAssetForExecution',
      },
    },
  },
}));

vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: vi.fn(async () => ({
    userId: 'user_1',
    orgSlug: 'test-org',
  })),
}));

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

function createCtx() {
  const runMutation = vi.fn(
    async (ref: unknown, args: Record<string, unknown>) => {
      if (ref === 'getOrCreateProjectRootFolder') {
        return { folderId: 'folder_1', created: true };
      }
      if (ref === 'upsertDocumentByExternalId') {
        return {
          documentId: 'doc_1',
          action: 'created',
          contentChanged: true,
          args,
        };
      }
      return null;
    },
  );
  const runAction = vi.fn(
    async (ref: unknown, args: Record<string, unknown>) => {
      if (ref === 'storeRawContent') {
        return {
          success: true,
          fileStorageId: 'storage_1',
          fileName: args.fileName,
          contentType: args.contentType,
          size: 10,
          extension: args.extension,
          args,
        };
      }
      if (ref === 'readSkillAssetForExecution') {
        const map: Record<string, string> = {
          'mapping/rates.yaml': 'rates:\n  required: true\n',
          'mapping/checklist-codes.yaml': 'codes:\n  R01: required\n',
        };
        const content = map[args.assetPath as string];
        return content
          ? { ok: true, content }
          : { ok: false, error: 'not_found' };
      }
      return null;
    },
  );
  return { ctx: { runMutation, runAction }, runMutation, runAction };
}

const BASE = {
  organizationId: 'org_1',
  projectId: 'project_1',
  folderName: 'Setup',
  fileName: 'profile.yaml',
};

describe('ensureProjectTextDocument', () => {
  const handler = (ensureProjectTextDocument as unknown as Handler).handler;

  it('stores YAML from the yaml map and upserts into the folder', async () => {
    const { ctx, runMutation, runAction } = createCtx();
    const result = await handler(ctx, {
      ...BASE,
      yaml: {
        client: 'Acme AG',
        case_id: 'CASE-123456',
      },
    });

    expect(result).toEqual({
      folderId: 'folder_1',
      documentId: 'doc_1',
      createdFolder: true,
      action: 'created',
    });

    expect(runMutation).toHaveBeenCalledWith(
      'getOrCreateProjectRootFolder',
      expect.objectContaining({
        organizationId: 'org_1',
        projectId: 'project_1',
        name: 'Setup',
        userId: 'user_1',
      }),
    );

    const storeCall = runAction.mock.calls.find(
      ([ref]) => ref === 'storeRawContent',
    );
    expect(storeCall?.[1]).toMatchObject({
      fileName: 'profile.yaml',
      contentType: 'text/yaml',
      extension: 'yaml',
      content: 'client: "Acme AG"\ncase_id: "CASE-123456"\n',
    });

    expect(runMutation).toHaveBeenCalledWith(
      'upsertDocumentByExternalId',
      expect.objectContaining({
        folderId: 'folder_1',
        fileId: 'storage_1',
        title: 'profile.yaml',
        externalItemId: 'project-text:project_1:Setup:profile.yaml',
      }),
    );
  });

  it('rejects when both content and yaml are set', async () => {
    const { ctx } = createCtx();
    await expect(
      handler(ctx, { ...BASE, content: 'x', yaml: { a: 'b' } }),
    ).rejects.toMatchObject({
      data: { code: 'INVALID_ARGUMENT' },
    });
  });

  it('rejects when neither content nor yaml is set', async () => {
    const { ctx } = createCtx();
    await expect(handler(ctx, BASE)).rejects.toMatchObject({
      data: { code: 'INVALID_ARGUMENT' },
    });
  });

  it('accepts raw content', async () => {
    const { ctx, runAction } = createCtx();
    await handler(ctx, { ...BASE, content: 'hello: world\n' });
    const storeCall = runAction.mock.calls.find(
      ([ref]) => ref === 'storeRawContent',
    );
    expect(storeCall?.[1]).toMatchObject({ content: 'hello: world\n' });
  });

  it('skips skill-file seeding while the skills backend is offline, keeping the primary doc', async () => {
    const { ctx, runAction } = createCtx();
    const result = await handler(ctx, {
      ...BASE,
      yaml: { client: 'Acme AG' },
      seedSkillFiles: [
        {
          skillSlug: 'document-verify',
          skillPath: 'mapping/rates.yaml',
          fileName: 'rates.yaml',
          externalItemId: 'acme:project_1:rates.yaml',
        },
        {
          skillSlug: 'document-verify',
          skillPath: 'mapping/checklist-codes.yaml',
          fileName: 'checklist-codes.yaml',
        },
      ],
    });
    // The primary document is created; no companion files are seeded while the
    // skills backend is offline, and no skill asset is read.
    expect(result.documentId).toBe('doc_1');
    expect(result.seededSkillFiles).toBe(0);
    expect(runAction).not.toHaveBeenCalledWith(
      'readSkillAssetForExecution',
      expect.anything(),
    );
  });
});
