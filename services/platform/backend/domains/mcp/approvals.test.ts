// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { ENGINE_TOOL_ARGS } from '../../../lib/mcp/args';
import { MCP_PROMPTS } from '../../../lib/mcp/prompts';
import {
  MCP_RESOURCE_TEMPLATES,
  MCP_STATIC_RESOURCES,
} from '../../../lib/mcp/resources';
import { MCP_TOOLS } from '../../../lib/mcp/tools';
import type { McpCaller } from './caller';
import { handleMcpRequest } from './protocol';

/**
 * An approval is a person's decision, made in Tale. A coding agent can start
 * the run that waits for one and read that it waits, but nothing it can call
 * over MCP decides one: not a tool, a resource or a prompt, and not any code
 * the endpoint loads. The approvals domain (`decideApproval` and the session
 * routes that call it) is the one place a gated step's approval is decided,
 * so the door's module graph must never reach it.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const DOOR = path.join(PLATFORM_ROOT, 'backend/rest/v1-mcp.ts');
const APPROVALS_DOMAIN = path.join(PLATFORM_ROOT, 'backend/domains/approvals');

const compilerOptions = (() => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(PLATFORM_ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (!parsed) throw new Error('services/platform/tsconfig.json did not parse');
  return parsed.options;
})();

/**
 * Every module of this workspace the MCP door loads: each static import and
 * re-export, and each dynamic `import()` of a literal, followed from
 * `backend/rest/v1-mcp.ts`. The walk stays inside the workspace — a shared
 * package cannot import the platform's backend — and records the relative
 * imports it could not resolve, which would make it blind.
 */
function doorModules(): { modules: Set<string>; unresolved: string[] } {
  const modules = new Set<string>();
  const unresolved: string[] = [];
  const queue = [DOOR];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || modules.has(file)) continue;
    modules.add(file);
    const source = readFileSync(file, 'utf8');
    for (const { fileName } of ts.preProcessFile(source, true, true)
      .importedFiles) {
      const resolved = ts.resolveModuleName(
        fileName,
        file,
        compilerOptions,
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (resolved === undefined) {
        if (fileName.startsWith('.')) unresolved.push(`${file}: ${fileName}`);
        continue;
      }
      if (
        !resolved.startsWith(PLATFORM_ROOT + path.sep) ||
        resolved.split(path.sep).includes('node_modules') ||
        /\.d\.[cm]?ts$/.test(resolved)
      ) {
        continue;
      }
      queue.push(resolved);
    }
  }
  return { modules, unresolved };
}

function relative(file: string): string {
  return path.relative(PLATFORM_ROOT, file).split(path.sep).join('/');
}

describe('no tool decides an approval [MCP-R6]', () => {
  it('the MCP door never loads the code that decides an approval', () => {
    const { modules, unresolved } = doorModules();
    expect(unresolved).toEqual([]);
    // The walk reached the door's tools, so an empty answer below is a
    // finding about the graph and not a walk that stopped at the door.
    expect([...modules].map(relative)).toEqual(
      expect.arrayContaining([
        'backend/domains/mcp/protocol.ts',
        'backend/domains/mcp/engine-host.ts',
        'backend/domains/chat/capabilities.ts',
        'backend/domains/automations/ask-answer.ts',
      ]),
    );
    expect(
      [...modules]
        .filter((file) => file.startsWith(APPROVALS_DOMAIN + path.sep))
        .map(relative),
    ).toEqual([]);
  });

  it('no tool, resource or prompt is one that decides an approval', () => {
    const names = [
      ...MCP_TOOLS.map((tool) => tool.name),
      ...MCP_PROMPTS.map((prompt) => prompt.name),
      ...MCP_STATIC_RESOURCES.map((resource) => resource.uri),
      ...MCP_RESOURCE_TEMPLATES.map((template) => template.uriTemplate),
    ];
    expect(names.filter((name) => /approv|decide|reject/i.test(name))).toEqual(
      [],
    );
    // The one tool that answers for a person answers a question the run
    // asked, by its id — never an approval.
    expect(Object.keys(ENGINE_TOOL_ARGS.answer_run_ask.shape).sort()).toEqual([
      'answer',
      'askId',
      'runId',
    ]);
  });

  it('a gated capability answers the run that waits, as an answer and not a decision', async () => {
    const caller: McpCaller = {
      organizationId: 'org_apv_1',
      orgSlug: 'acme',
      userId: 'user_ada',
      role: 'developer',
      credential: { kind: 'api-key', apiKeyId: 'key_apv_1' },
    };
    const waiting = {
      runId: 'run_refund_1',
      version: 3,
      mode: 'live',
      status: 'waiting',
      note: 'the run is still going after 30s — poll get_run {runId} for its status, output, trace and effects',
    };
    const capability = vi.fn().mockResolvedValue({
      status: 'ok',
      id: 'automation.billing/refund',
      kind: 'automation',
      structured: false,
      output: waiting,
    });
    const unused = vi.fn();
    const response = await handleMcpRequest(
      caller,
      new Request('https://app.example.test/api/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'invoke_capability',
            arguments: { id: 'automation.billing/refund', input: {} },
          },
        }),
      }),
      { host: { engine: unused, platform: unused, capability } },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tools/call answer
    const payload = (await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(capability).toHaveBeenCalledWith(caller, 'invoke_capability', {
      id: 'automation.billing/refund',
      input: {},
    });
    expect(unused).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(false);
    expect(JSON.parse(payload.result.content[0].text)).toMatchObject({
      status: 'ok',
      output: { runId: 'run_refund_1', status: 'waiting' },
    });
  });
});
