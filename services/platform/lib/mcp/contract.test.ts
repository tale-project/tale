// @vitest-environment node

import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { API_CONTRACT_VERSION } from '../shared/constants/api-contract';
import { mcpInventoryFingerprint, withoutProse } from './contract';
import { toolListing } from './listing';
import { MCP_SERVER_INFO } from './server';
import { MCP_TOOLS } from './tools';

/**
 * The MCP surface moves with the contract version, like the REST surface
 * (`scripts/openapi/spec.test.ts`): the fingerprint of what a client can
 * depend on is recorded beside the version it shipped in, and a change to
 * it without a new version fails here.
 *
 * When this fails because the inventory changed on purpose: give
 * `API_CONTRACT_VERSION` (`lib/shared/constants/api-contract.ts`) the next
 * minor with a paragraph naming the MCP change — unless this change already
 * belongs to a version that has not shipped yet — then record the printed
 * fingerprint and the version in `contract-fingerprint.json`.
 */

const RECORDED = new URL('./contract-fingerprint.json', import.meta.url);
const SNAPSHOT = new URL('./tools.schema.snapshot.json', import.meta.url);

const recorded: { version: string; fingerprint: string } = JSON.parse(
  readFileSync(RECORDED, 'utf8'),
);

describe('the MCP contract moves with the contract version', () => {
  test('records the fingerprint of the inventory the endpoint advertises', () => {
    const current = mcpInventoryFingerprint();
    expect(
      current,
      `the MCP inventory's fingerprint is ${current} — see the note at the top of this file`,
    ).toBe(recorded.fingerprint);
  });

  test('records it with the version the server answers', () => {
    expect(recorded.version).toBe(API_CONTRACT_VERSION);
    expect(MCP_SERVER_INFO.version).toBe(API_CONTRACT_VERSION);
  });

  test('a reworded description is not a contract change; a new argument is', () => {
    const listed = MCP_TOOLS.map(toolListing);
    const reworded = listed.map((tool) => ({
      ...tool,
      description: `${tool.description} Now with more words.`,
      inputSchema: {
        ...tool.inputSchema,
        description: 'A different sentence.',
      },
    }));
    expect(mcpInventoryFingerprint(reworded)).toBe(
      mcpInventoryFingerprint(listed),
    );
    const widened = listed.map((tool, index) =>
      index === 0
        ? {
            ...tool,
            inputSchema: {
              ...tool.inputSchema,
              properties: { extra: { type: 'string' } },
            },
          }
        : tool,
    );
    expect(mcpInventoryFingerprint(widened)).not.toBe(
      mcpInventoryFingerprint(listed),
    );
  });

  test('prose is dropped from schema nodes, never a property named like it', () => {
    expect(
      withoutProse({
        type: 'object',
        description: 'gone',
        properties: {
          description: { type: 'string', description: 'gone too' },
          list: { type: 'array', items: { title: 'gone', type: 'string' } },
        },
        required: ['description'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        description: { type: 'string' },
        list: { type: 'array', items: { type: 'string' } },
      },
      required: ['description'],
    });
  });
});

/**
 * Every advertised schema, as a reviewer reads it: a change to a tool's
 * arguments or answer shows up in this file's diff. Regenerate with
 * `UPDATE_MCP_SCHEMA_SNAPSHOT=1 bunx vitest run --project server
 * lib/mcp/contract.test.ts` and review what moved.
 */
describe('the advertised schemas', () => {
  const schemas = Object.fromEntries(
    MCP_TOOLS.map(toolListing).map((tool) => [
      tool.name,
      {
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema === undefined
          ? {}
          : { outputSchema: tool.outputSchema }),
      },
    ]),
  );

  test('match the reviewed snapshot', () => {
    if (process.env.UPDATE_MCP_SCHEMA_SNAPSHOT === '1') {
      writeFileSync(SNAPSHOT, `${JSON.stringify(schemas, null, 2)}\n`);
    }
    expect(schemas).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  });
});
