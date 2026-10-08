import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  drainHarnessWindow,
  sessionStageFiles,
  withLegacyAgentPorts,
} from '../fixtures/automation-legacy-v1/agent-flow-adapter.ts';

const root = new URL('../../../../', import.meta.url);
const fixtures = new URL('../fixtures/automation-legacy-v1/', import.meta.url);
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const section = z.strictObject({
  name: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  sha256: sha,
});
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.literal('b4931db4b48bdfde37afe1af2a1479e6640a0799'),
  files: z
    .array(
      z.strictObject({
        sourcePath: z.string(),
        blob: z.string().regex(/^[a-f0-9]{40}$/),
        rawFile: z.enum(['agent.raw.txt', 'shim.raw.txt']),
        rawSha256: sha,
        moduleFile: z.enum(['agent-flow.ts', 'shim-flow.ts']),
        sections: z.array(section).min(1),
      }),
    )
    .length(2),
  reused: z.array(
    z.strictObject({
      sourcePath: z.string().startsWith('services/platform/'),
      names: z.array(z.string()),
      blob: z.string().regex(/^[a-f0-9]{40}$/),
      sha256: sha.optional(),
      sections: z
        .array(z.strictObject({ name: z.string(), sha256: sha }))
        .optional(),
    }),
  ),
});
function declarations(text: string): Map<string, string> {
  const source = ts.createSourceFile(
    'fixture.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = new Map<string, string>();
  for (const node of source.statements) {
    const names = ts.isVariableStatement(node)
      ? node.declarationList.declarations.flatMap((decl) =>
          ts.isIdentifier(decl.name) ? [decl.name.text] : [],
        )
      : (ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isEnumDeclaration(node)) &&
          node.name !== undefined
        ? [node.name.text]
        : [];
    for (const name of names)
      result.set(name, text.slice(node.getStart(source), node.end));
  }
  return result;
}

describe('complete released legacy agent flows', () => {
  it('keeps both complete entry bodies, mint, settle and exact old SQL byte-bound', async () => {
    const manifest = schema.parse(
      JSON.parse(
        await readFile(new URL('agent-flow-provenance.json', fixtures), 'utf8'),
      ),
    );
    for (const file of manifest.files) {
      const raw = await readFile(new URL(file.rawFile, fixtures), 'utf8');
      expect(hash(raw)).toBe(file.rawSha256);
      expect(
        createHash('sha1')
          .update(`blob ${Buffer.byteLength(raw)}\0`)
          .update(raw)
          .digest('hex'),
      ).toBe(file.blob);
      const module = await readFile(new URL(file.moduleFile, fixtures), 'utf8');
      for (const part of file.sections) {
        const body = raw.slice(part.start, part.end);
        expect(hash(body)).toBe(part.sha256);
        expect(module.split(body)).toHaveLength(2);
        expect(module.replace(body, body.slice(0, -1))).not.toContain(body);
      }
    }
    const agent = manifest.files.find(
      (file) => file.moduleFile === 'agent-flow.ts',
    );
    expect(agent?.sections.map((part) => part.name)).toEqual(
      expect.arrayContaining([
        'startWorkflowAgentTurnImpl',
        'resumeWorkflowAgentTurnWithAnswerImpl',
        'mintWorkflowTurnAuth',
        'settleWorkflowAgentTurn',
        'releaseTurnKey',
        'reapRefusedStart',
        'readCursorState',
      ]),
    );
    const shim = manifest.files.find(
      (file) => file.moduleFile === 'shim-flow.ts',
    );
    expect(shim?.sections.map((part) => part.name)).toEqual(
      expect.arrayContaining([
        'automations/queries:readAgentCursor',
        'automations/mutations:stampAgentTurnLaunch',
        'automations/human_asks:retargetAgentCursor',
        'automations/mutations:recordAgentTurnSettled',
      ]),
    );
  });

  it('reuses unchanged historical helpers without importing a newer fence', async () => {
    const manifest = schema.parse(
      JSON.parse(
        await readFile(new URL('agent-flow-provenance.json', fixtures), 'utf8'),
      ),
    );
    for (const reused of manifest.reused) {
      const text = await readFile(new URL(reused.sourcePath, root), 'utf8');
      if (reused.sha256 !== undefined) {
        expect(hash(text)).toBe(reused.sha256);
        expect(
          createHash('sha1')
            .update(`blob ${Buffer.byteLength(text)}\0`)
            .update(text)
            .digest('hex'),
        ).toBe(reused.blob);
      } else {
        expect(reused.sections?.length).toBeGreaterThan(0);
        const parsed = declarations(text);
        for (const entry of reused.sections ?? [])
          expect(hash(parsed.get(entry.name) ?? '')).toBe(entry.sha256);
      }
    }
  });

  it('keeps recording ports instance-owned and unsupported services loud', async () => {
    await expect(
      drainHarnessWindow({
        sessionId: 'fixture',
        execId: 'fixture',
        harness: 'claude-code',
      }),
    ).rejects.toThrow('ports are absent');
    const events: string[] = [];
    await withLegacyAgentPorts({ events }, async () => {
      expect(
        await drainHarnessWindow({
          sessionId: 'fixture',
          execId: 'fixture',
          harness: 'claude-code',
        }),
      ).toEqual({ kind: 'running', text: '', timeline: [] });
      expect(() => sessionStageFiles('fixture', [])).toThrow(
        'unsupported external port',
      );
    });
    expect(events).toEqual(['harness']);
  });
});
