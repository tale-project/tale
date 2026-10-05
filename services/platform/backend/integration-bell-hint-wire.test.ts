import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

type Lane = (
  sql: unknown,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
) => Promise<void>;

function isLane(value: unknown): value is Lane {
  return typeof value === 'function';
}

function bellLane(globals: Record<string, unknown>): Lane {
  const source = ts.createSourceFile(
    'integration-check.ts',
    readFileSync(new URL('./integration-check.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'checkBellHintWire',
  );
  if (declaration === undefined) throw new Error('Missing bell lane');
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const lane: unknown = runInNewContext(
    `${compiled}\ncheckBellHintWire`,
    globals,
  );
  if (!isLane(lane)) throw new Error('Expected the bell lane function');
  return lane;
}

describe('the actual bell lane cleans up on failure (#4077, #4133)', () => {
  it.each([false, true])(
    'deletes its project even when closing a tail fails: %s',
    async (closeFails) => {
      let projectExists = false;
      const statements: string[] = [];
      const sql = (strings: TemplateStringsArray): Promise<unknown[]> => {
        const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
        statements.push(text);
        if (text.startsWith('INSERT INTO app.projects')) projectExists = true;
        if (text.startsWith('INSERT INTO app.tasks')) {
          throw new Error('Synthetic task insert failure');
        }
        if (text.startsWith('DELETE FROM app.projects')) projectExists = false;
        return Promise.resolve([]);
      };
      const ownerClose = vi.fn(async () => {
        if (closeFails) throw new Error('Synthetic tail close failure');
      });
      const mateClose = vi.fn(async () => undefined);
      const connectSse = vi
        .fn()
        .mockReturnValueOnce({ close: ownerClose })
        .mockReturnValueOnce({ close: mateClose });
      const lane = bellLane({
        signUpUser: async () => ({ cookie: 'mate-cookie', userId: 'mate' }),
        fetch: async () => ({ ok: true }),
        connectSse,
        sleep: async () => undefined,
        latestOutboxId: async () => '0',
      });

      await expect(
        lane(sql, 'http://example.invalid', {
          cookie: 'owner-cookie',
          orgId: 'org-synthetic',
          userId: 'owner',
        }),
      ).rejects.toThrow(
        closeFails
          ? 'Synthetic tail close failure'
          : 'Synthetic task insert failure',
      );

      expect(ownerClose).toHaveBeenCalledTimes(1);
      expect(mateClose).toHaveBeenCalledTimes(1);
      expect(statements[0]).toContain('INSERT INTO app.projects');
      expect(statements.at(-1)).toBe(
        "DELETE FROM app.projects WHERE id = 'p-bell-wire' AND org_id = ?",
      );
      expect(projectExists).toBe(false);
    },
  );
});
