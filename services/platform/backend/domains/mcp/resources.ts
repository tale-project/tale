/**
 * The MCP endpoint's resources, as the protocol layer serves them:
 * `resources/list`, `resources/templates/list` and `resources/read`.
 *
 * A resource is a read a tool already answers (`lib/mcp/resources.ts` maps
 * each address to its call), and reading it IS that call: it goes through
 * `callTool` — the arguments checked, the role, the request budget, the
 * surface, the refusal lifting — so an address can never show what the tool
 * would refuse. An automation installed only in projects the person cannot
 * read is "not found" here exactly as `get_automation` answers it.
 *
 * Resources have no `isError`: a refusal becomes a JSON-RPC error — an
 * address that reads nothing is -32002 (resource not found) with the
 * refusal's own code under `data.code`, an address that cannot be one is
 * -32602, and a fault is -32603 with the request id.
 */

import { z } from 'zod';

import {
  automationResourceUri,
  MCP_RESOURCE_TEMPLATES,
  MCP_STATIC_RESOURCES,
  type McpResourceListing,
  resourceTarget,
} from '../../../lib/mcp/resources';
import { findMcpTool } from '../../../lib/mcp/tools';
import type { McpCallOutcome } from './activity';
import type { McpCaller } from './caller';
import { callTool, type ToolAnswer, type ToolCallContext } from './tools';

/** MCP's code for an address that reads nothing. */
const RESOURCE_NOT_FOUND = -32002;

/** How many automations one `resources/list` page lists. */
export const RESOURCES_PAGE_SIZE = 100;

/** The longest address this endpoint reads — a longer one names nothing it
 * serves, and is never echoed back. */
const MAX_URI_LENGTH = 2048;

/** A JSON-RPC error a resource or prompt method answers with, and how the
 * call went for the call record. */
export interface MethodError {
  readonly code: number;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly outcome: McpCallOutcome;
}

/** What a resource or prompt method answers: its result, a JSON-RPC error,
 * or — for a batch call the request budget refused — the wait. */
export type MethodReply<T> =
  | { readonly kind: 'result'; readonly result: T }
  | { readonly kind: 'error'; readonly error: MethodError }
  | { readonly kind: 'admission'; readonly retryAfterMs: number };

export function methodError(
  code: number,
  message: string,
  data?: Record<string, unknown>,
  outcome: McpCallOutcome = 'refused',
): { kind: 'error'; error: MethodError } {
  return {
    kind: 'error',
    error: { code, message, ...(data === undefined ? {} : { data }), outcome },
  };
}

const refusalShape = z.looseObject({
  error: z.string(),
  code: z.string(),
  hint: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * A tool answer that refused, as the JSON-RPC error a resource or prompt
 * method answers: arguments the address could not supply are -32602, a
 * fault is -32603 with its request id, and every other refusal — a name
 * nobody saved, a run that does not exist, an automation the person cannot
 * see — is `otherwise` (for a read, -32002 "Resource not found") with the
 * refusal's code and words.
 */
function refusalAsError(
  answer: ToolAnswer,
  otherwise: { readonly code: number; readonly label: string },
  context: Record<string, unknown>,
): { kind: 'error'; error: MethodError } {
  const refusal = refusalShape.safeParse(answer.value);
  if (answer.outcome === 'error' || !refusal.success) {
    return methodError(
      -32603,
      'Internal error: the read failed unexpectedly',
      {
        ...context,
        code: refusal.success ? refusal.data.code : 'INTERNAL_ERROR',
        ...(refusal.success ? (refusal.data.data ?? {}) : {}),
      },
      'error',
    );
  }
  const { error, code, hint, data } = refusal.data;
  const invalid = code === 'INVALID_ARGUMENTS';
  return methodError(
    invalid ? -32602 : otherwise.code,
    `${invalid ? 'Invalid params' : otherwise.label}: ${error}`,
    {
      ...context,
      code,
      ...(hint === undefined ? {} : { hint }),
      ...(data === undefined ? {} : { data }),
    },
  );
}

/** How a read that found nothing is answered. */
const NOT_FOUND = { code: RESOURCE_NOT_FOUND, label: 'Resource not found' };

/** One resource's contents. */
export interface ResourceContents {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

/** `resources/read`: the address's tool call, answered as its contents. */
export async function readResource(
  caller: McpCaller,
  uri: unknown,
  context: ToolCallContext,
): Promise<MethodReply<{ contents: ResourceContents[] }>> {
  if (typeof uri !== 'string' || uri === '') {
    return methodError(
      -32602,
      'Invalid params: resources/read needs a string `uri`',
    );
  }
  if (uri.length > MAX_URI_LENGTH) {
    return methodError(
      -32602,
      `Invalid params: a resource address is at most ${MAX_URI_LENGTH} characters`,
    );
  }
  const target = resourceTarget(uri);
  const tool = 'problem' in target ? undefined : findMcpTool(target.tool);
  if ('problem' in target || tool === undefined) {
    return 'problem' in target && target.problem === 'invalid'
      ? methodError(
          -32602,
          'Invalid params: this address cannot name a resource — resources/templates/list says how an address is built',
          { uri },
        )
      : methodError(
          RESOURCE_NOT_FOUND,
          'Resource not found: resources/list and resources/templates/list name what this server serves',
          { uri },
        );
  }
  const reply = await callTool(caller, tool, target.args, context);
  if (reply.kind === 'admission') return reply;
  const { answer } = reply;
  if (answer.result.isError) {
    return refusalAsError(answer, NOT_FOUND, { uri });
  }
  const docs =
    target.textField === 'docs'
      ? z.looseObject({ docs: z.string() }).safeParse(answer.value)
      : undefined;
  const text = docs?.success ? docs.data.docs : JSON.stringify(answer.value);
  return {
    kind: 'result',
    result: { contents: [{ uri, mimeType: target.mimeType, text }] },
  };
}

const automationsShape = z.looseObject({
  automations: z.array(
    z.looseObject({
      name: z.string(),
      latest: z.number().nullable().optional(),
      deployedVersion: z.number().nullable().optional(),
    }),
  ),
});

const cursorShape = z.strictObject({ after: z.string().min(1) });

/** A page cursor: the last name the previous page listed. It carries only
 * what that caller was already shown — a forged one lists nothing they
 * could not list anyway. */
function encodeCursor(after: string): string {
  return Buffer.from(JSON.stringify({ after })).toString('base64url');
}

function decodeCursor(cursor: string): string | null {
  try {
    const parsed = cursorShape.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data.after : null;
  } catch (error) {
    console.warn(
      '[mcp] resources/list cursor is not one this server issued:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** One automation as `resources/list` lists it. */
function automationListing(automation: {
  name: string;
  latest?: number | null | undefined;
  deployedVersion?: number | null | undefined;
}): McpResourceListing {
  const latest =
    automation.latest === undefined || automation.latest === null
      ? 'no saved version'
      : `latest version ${automation.latest}`;
  const live =
    automation.deployedVersion === undefined ||
    automation.deployedVersion === null
      ? 'not deployed'
      : `version ${automation.deployedVersion} deployed`;
  return {
    uri: automationResourceUri(automation.name),
    name: `automations/${automation.name}`,
    title: automation.name,
    description: `The automation ${automation.name}: ${latest}, ${live}.`,
    mimeType: 'application/json',
  };
}

/**
 * `resources/list`: the references and the catalog, then every automation
 * the person can see — read through `list_automations`, so the list is the
 * one that tool answers — by name, a page at a time.
 */
export async function listResources(
  caller: McpCaller,
  cursor: unknown,
  context: ToolCallContext,
): Promise<
  MethodReply<{ resources: McpResourceListing[]; nextCursor?: string }>
> {
  let after: string | null = null;
  if (cursor !== undefined) {
    after = typeof cursor === 'string' ? decodeCursor(cursor) : null;
    if (after === null) {
      return methodError(
        -32602,
        'Invalid params: this cursor is not one resources/list issued — omit it for the first page',
      );
    }
  }
  const tool = findMcpTool('list_automations');
  if (tool === undefined) {
    return {
      kind: 'result',
      result: { resources: after === null ? [...MCP_STATIC_RESOURCES] : [] },
    };
  }
  const reply = await callTool(caller, tool, {}, context);
  if (reply.kind === 'admission') return reply;
  if (reply.answer.result.isError) {
    return refusalAsError(
      reply.answer,
      { code: -32603, label: 'Internal error' },
      {},
    );
  }
  const parsed = automationsShape.safeParse(reply.answer.value);
  const names = (parsed.success ? parsed.data.automations : [])
    .filter((automation) => after === null || automation.name > after)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const page = names.slice(0, RESOURCES_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    kind: 'result',
    result: {
      resources: [
        ...(after === null ? MCP_STATIC_RESOURCES : []),
        ...page.map(automationListing),
      ],
      ...(names.length > RESOURCES_PAGE_SIZE && last !== undefined
        ? { nextCursor: encodeCursor(last.name) }
        : {}),
    },
  };
}

/** `resources/templates/list`: the addresses a client fills in. */
export function listResourceTemplates(): {
  resourceTemplates: typeof MCP_RESOURCE_TEMPLATES;
} {
  return { resourceTemplates: MCP_RESOURCE_TEMPLATES };
}
