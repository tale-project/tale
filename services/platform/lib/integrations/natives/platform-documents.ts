/**
 * Native backend for the `document` platform connector — the org's document
 * tree as automation capabilities: list a folder's stored files and file
 * (claim) a produced blob into a folder as a document row.
 *
 * `create` is the second half of the sandbox harvest contract: an agent or
 * script run stores its outputs as unclaimed blobs (`source: 'agent'`, no
 * document row); this capability claims one into a folder, which is what
 * makes it a document a person can see. Idempotent via `externalItemId`, so
 * a resumed run re-presents the same claim instead of duplicating the file.
 */

import { z } from 'zod';

import type {
  NativeIntegrationContext,
  NativeIntegrationImpl,
} from '../dispatcher';
import { IntegrationError } from '../errors';

export interface WorkflowFolderFile {
  name: string;
  storageId: string;
}

/** What the rim needs from the platform's document domain. */
export interface WorkflowDocumentStore {
  listFolder(args: {
    organizationId: string;
    folderId?: string;
    folderPath?: string;
  }): Promise<WorkflowFolderFile[] | null>;
  create(args: {
    organizationId: string;
    folderId: string;
    name: string;
    storageId?: string;
    content?: string;
    contentType?: string;
    externalItemId?: string;
  }): Promise<{ documentId: string; action: string }>;
}

const listInput = z
  .object({
    folderId: z.string().min(1).optional(),
    folderPath: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.folderId !== undefined || value.folderPath !== undefined,
    {
      message: 'name a folderId or a folderPath',
    },
  );

const createInput = z
  .object({
    folderId: z.string().min(1),
    name: z.string().min(1),
    storageId: z.string().min(1).optional(),
    content: z.string().optional(),
    contentType: z.string().min(1).optional(),
    externalItemId: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.storageId !== undefined) !== (value.content !== undefined),
    {
      message:
        'provide exactly one of storageId (a harvested blob) or content (inline text)',
    },
  );

function refuse(action: string, issues: z.ZodError): never {
  throw new IntegrationError(
    'INPUT_INVALID',
    `document.${action}: ${issues.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
      .join('; ')}`,
    {},
  );
}

export function platformDocumentNatives(
  store: WorkflowDocumentStore,
): Readonly<Record<string, NativeIntegrationImpl>> {
  const list: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const parsed = listInput.safeParse(input);
    if (!parsed.success) refuse('list', parsed.error);
    const files = await store.listFolder({
      organizationId: ctx.organizationId,
      ...(parsed.data.folderId !== undefined
        ? { folderId: parsed.data.folderId }
        : {}),
      ...(parsed.data.folderPath !== undefined
        ? { folderPath: parsed.data.folderPath }
        : {}),
    });
    if (files === null) {
      throw new IntegrationError(
        'INPUT_INVALID',
        `document.list: the folder does not exist (${JSON.stringify(parsed.data)})`,
        {},
      );
    }
    return { count: files.length, files };
  };

  const create: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const parsed = createInput.safeParse(input);
    if (!parsed.success) refuse('create', parsed.error);
    return await store.create({
      organizationId: ctx.organizationId,
      folderId: parsed.data.folderId,
      name: parsed.data.name,
      ...(parsed.data.storageId !== undefined
        ? { storageId: parsed.data.storageId }
        : {}),
      ...(parsed.data.content !== undefined
        ? { content: parsed.data.content }
        : {}),
      ...(parsed.data.contentType !== undefined
        ? { contentType: parsed.data.contentType }
        : {}),
      ...(parsed.data.externalItemId !== undefined
        ? { externalItemId: parsed.data.externalItemId }
        : {}),
    });
  };

  return { 'document.list': list, 'document.create': create };
}
