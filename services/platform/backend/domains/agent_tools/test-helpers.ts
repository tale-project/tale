import type { Sql } from 'postgres';
import { vi } from 'vitest';

import type { WorkLoadout } from '../../../lib/agent/ladder.ts';
import type { ToolArtifact } from '../../../lib/chat/tools.ts';
import type { InputFile, WorkToolScope } from './scope.ts';

/** Every work tool offered — the loadout a test narrows. */
export const FULL_LOADOUT: WorkLoadout = {
  createFile: true,
  generateImage: true,
  skills: true,
  runCode: true,
};

export interface StoredFile {
  name: string;
  mediaType: string;
  text: string;
  size: number;
}

/**
 * A work-tool scope for unit tests: an artifact sink that records what it
 * stores, the conversation's files as a map, a database that answers every
 * statement with no rows.
 */
export function testScope(
  overrides: Partial<WorkToolScope> & { files?: readonly InputFile[] } = {},
): { scope: WorkToolScope; stored: StoredFile[] } {
  const stored: StoredFile[] = [];
  const { files = [], ...rest } = overrides;
  const sql = vi.fn(() => Promise.resolve([]));
  const scope: WorkToolScope = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
    sql: sql as unknown as Sql,
    organizationId: 'org_1',
    orgSlug: 'acme',
    userId: 'user_1',
    skillViewer: {
      kind: 'user',
      userId: 'user_1',
      teamIds: [],
      isOrgAdmin: false,
    },
    sandboxOwnerKey: 'thread-root',
    loadout: FULL_LOADOUT,
    artifacts: {
      store(file): Promise<ToolArtifact> {
        stored.push({
          name: file.name,
          mediaType: file.mediaType,
          text: new TextDecoder().decode(file.bytes),
          size: file.bytes.byteLength,
        });
        return Promise.resolve({
          ref: `s3:acme/out-${stored.length}`,
          name: file.name,
          mediaType: file.mediaType,
          sizeBytes: file.bytes.byteLength,
        });
      },
    },
    inputs: {
      resolve(refs) {
        const byRef = new Map(files.map((file) => [file.ref, file]));
        return Promise.resolve(
          new Map(
            refs.flatMap((ref) => {
              const file = byRef.get(ref);
              return file === undefined ? [] : [[ref, file] as const];
            }),
          ),
        );
      },
    },
    ...rest,
  };
  return { scope, stored };
}
