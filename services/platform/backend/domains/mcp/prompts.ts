/**
 * The MCP endpoint's prompts, as the protocol layer serves them:
 * `prompts/list` and `prompts/get`.
 *
 * A prompt's message is built from its arguments (`lib/mcp/prompts.ts`); the
 * automation, run or reference it is about is read as a resource — through
 * the same tool call, with the caller's own rights (`resources.ts`) — and
 * attached to the message. An attachment the prompt needs that the caller
 * cannot read refuses the prompt (-32602) with the read's own code; an
 * optional one is left out, and the message says so.
 */

import {
  findMcpPrompt,
  MCP_PROMPTS,
  promptListing,
  promptText,
} from '../../../lib/mcp/prompts';
import { houseIssueMessage } from '../../rest/shared';
import type { McpCaller } from './caller';
import {
  methodError,
  type MethodReply,
  readResource,
  type ResourceContents,
} from './resources';
import { argumentIssues, type ToolCallContext } from './tools';

/** `prompts/list`: every prompt whose tools the inventory holds. */
export function listPrompts(): {
  prompts: ReturnType<typeof promptListing>[];
} {
  return { prompts: MCP_PROMPTS.map(promptListing) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One message of a prompt's answer. */
type PromptMessage =
  | { role: 'user'; content: { type: 'text'; text: string } }
  | { role: 'user'; content: { type: 'resource'; resource: ResourceContents } };

/** `prompts/get`: the prompt's message for these arguments, with what it is
 * about attached. */
export async function getPrompt(
  caller: McpCaller,
  params: Record<string, unknown>,
  context: ToolCallContext,
): Promise<MethodReply<{ description: string; messages: PromptMessage[] }>> {
  const { name } = params;
  if (typeof name !== 'string') {
    return methodError(
      -32602,
      'Invalid params: prompts/get needs a string `name`',
    );
  }
  const prompt = findMcpPrompt(name);
  if (prompt === undefined) {
    return methodError(
      -32602,
      `Invalid params: no prompt named "${name.slice(0, 64)}" — prompts/list names them`,
    );
  }
  const raw = params.arguments ?? {};
  if (!isRecord(raw)) {
    return methodError(
      -32602,
      'Invalid params: a prompt’s arguments are an object of strings',
    );
  }
  const parsed = prompt.args.safeParse(raw, {
    reportInput: true,
    error: houseIssueMessage,
  });
  if (!parsed.success) {
    const issues = argumentIssues(parsed.error);
    const first = issues[0];
    return methodError(
      -32602,
      `Invalid params: ${first === undefined ? 'the arguments' : `"${first.path}" ${first.message}`}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}`,
      { code: 'INVALID_ARGUMENTS', issues },
    );
  }
  // One prompt is one call against the request budget, however many reads
  // it attaches.
  if (context.admit !== undefined) {
    const wait = await context.admit();
    if (wait !== null)
      return { kind: 'admission', retryAfterMs: wait.retryAfterMs };
  }
  const args = Object.fromEntries(
    Object.entries(parsed.data).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const attached: ResourceContents[] = [];
  for (const embed of prompt.embeds(args)) {
    const read = await readResource(caller, embed.uri, {
      host: context.host,
      requestId: context.requestId,
    });
    if (read.kind === 'result') {
      attached.push(...read.result.contents);
      continue;
    }
    if (read.kind === 'admission') {
      return read;
    }
    if (read.error.code === -32603) return read;
    if (embed.required) {
      return methodError(
        -32602,
        `Invalid params: ${read.error.message}`,
        read.error.data,
      );
    }
  }
  const embedded = new Set(attached.map((contents) => contents.uri));
  return {
    kind: 'result',
    result: {
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: promptText(prompt, args, embedded) },
        },
        ...attached.map((resource): PromptMessage => ({
          role: 'user',
          content: { type: 'resource', resource },
        })),
      ],
    },
  };
}
