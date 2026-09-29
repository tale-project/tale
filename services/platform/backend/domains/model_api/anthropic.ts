import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  GATEWAY_ONLY_FIELDS,
  invalidBody,
  isRelayableMediaUrl,
  ModelApiRefusal,
  type TextSegment,
  type WireRequest,
} from './wire.ts';

/**
 * The Anthropic Messages request as the door reads it — the facts it acts
 * on, the rest relayed as sent: the model, whether to stream, `max_tokens`,
 * the media and tools the request carries, and the system and user text the
 * input guardrails judge.
 *
 * The door refuses what it could not govern, naming the field:
 *  - a role other than `user` and `assistant` (the system prompt is the
 *    top-level `system`, text blocks only);
 *  - a user content block outside `text`, `image`, `document`,
 *    `tool_result` and `search_result` — every word a person sends is a text
 *    block the guardrails see;
 *  - an image or document URL source that is not `https:`;
 *  - a tool the model vendor runs (web search, web fetch, code execution,
 *    an MCP toolset) and the `mcp_servers` and `container` fields that feed
 *    them: neither metered nor audited here. The caller's own tools — plain
 *    ones and Anthropic's client-run `bash`, `text_editor`, `computer` and
 *    `memory` tools — are relayed.
 * Assistant turns and tool results are relayed unread: the model's own
 * output and the caller's tool data, which the guardrails do not judge.
 */

const CLIENT_TOOL_PREFIXES = ['bash_', 'text_editor_', 'computer_', 'memory_'];

function isClientTool(tool: unknown): boolean {
  if (!isRecord(tool)) return false;
  const type = tool.type;
  if (type === undefined || type === null || type === 'custom') return true;
  return (
    typeof type === 'string' &&
    CLIENT_TOOL_PREFIXES.some((prefix) => type.startsWith(prefix))
  );
}

const VENDOR_RUN_FIELDS = ['mcp_servers', 'container'] as const;

function vendorToolRefusal(param: string): ModelApiRefusal {
  return new ModelApiRefusal(
    400,
    'MODEL_API_VENDOR_TOOL_UNSUPPORTED',
    `${param}: only your own tools are relayed — a tool the model vendor runs (web search, web fetch, code execution, MCP servers) is neither metered nor audited here.`,
    { param },
  );
}

function blockSegment(
  block: Record<string, unknown>,
  role: TextSegment['role'],
): TextSegment {
  return {
    role,
    read: () => (typeof block.text === 'string' ? block.text : ''),
    write: (text) => {
      block.text = text;
    },
  };
}

function fieldSegment(
  holder: Record<string, unknown>,
  field: 'system' | 'content',
  role: TextSegment['role'],
): TextSegment {
  return {
    role,
    read: () => {
      const value = holder[field];
      return typeof value === 'string' ? value : '';
    },
    write: (text) => {
      holder[field] = text;
    },
  };
}

interface Tally {
  images: number;
  documents: number;
  segments: TextSegment[];
}

/** An image or document block's source: a URL one must be public https. */
function checkMediaSource(block: Record<string, unknown>, param: string): void {
  const source = block.source;
  if (!isRecord(source)) {
    throw invalidBody(`${param}.source`, 'must be an object');
  }
  if (
    source.type === 'url' &&
    (typeof source.url !== 'string' || !isRelayableMediaUrl(source.url))
  ) {
    throw invalidBody(`${param}.source.url`, 'must be an https: URL');
  }
}

/** Media inside a tool result, counted — the result itself is relayed
 * unread. */
function tallyToolResult(
  block: Record<string, unknown>,
  param: string,
  tally: Tally,
): void {
  if (!Array.isArray(block.content)) return;
  block.content.forEach((inner, index) => {
    if (!isRecord(inner)) return;
    const at = `${param}.content.${index}`;
    if (inner.type === 'image') {
      checkMediaSource(inner, at);
      tally.images += 1;
    } else if (inner.type === 'document') {
      checkMediaSource(inner, at);
      tally.documents += 1;
    }
  });
}

function readSystem(body: Record<string, unknown>, tally: Tally): void {
  const system = body.system;
  if (system === undefined || system === null) return;
  if (typeof system === 'string') {
    tally.segments.push(fieldSegment(body, 'system', 'system'));
    return;
  }
  if (!Array.isArray(system)) {
    throw invalidBody('system', 'must be a string or an array of text blocks');
  }
  system.forEach((block, index) => {
    if (
      !isRecord(block) ||
      block.type !== 'text' ||
      typeof block.text !== 'string'
    ) {
      throw invalidBody(
        `system.${index}`,
        'the system prompt takes text blocks only',
      );
    }
    tally.segments.push(blockSegment(block, 'system'));
  });
}

function readUserContent(
  message: Record<string, unknown>,
  param: string,
  tally: Tally,
): void {
  const content = message.content;
  if (typeof content === 'string') {
    tally.segments.push(fieldSegment(message, 'content', 'user'));
    return;
  }
  if (!Array.isArray(content)) {
    throw invalidBody(
      `${param}.content`,
      'must be a string or an array of content blocks',
    );
  }
  content.forEach((block, index) => {
    const at = `${param}.content.${index}`;
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw invalidBody(at, 'must be a content block with a "type"');
    }
    switch (block.type) {
      case 'text':
        if (typeof block.text !== 'string') {
          throw invalidBody(`${at}.text`, 'must be a string');
        }
        tally.segments.push(blockSegment(block, 'user'));
        return;
      case 'image':
        checkMediaSource(block, at);
        tally.images += 1;
        return;
      case 'document':
        checkMediaSource(block, at);
        tally.documents += 1;
        return;
      case 'tool_result':
        tallyToolResult(block, at, tally);
        return;
      case 'search_result':
        return;
      default:
        throw invalidBody(
          `${at}.type`,
          `"${block.type}" is not a content block this endpoint relays (text, image, document, tool_result, search_result)`,
        );
    }
  });
}

/** Read a Messages body. Throws a {@link ModelApiRefusal} naming the first
 * field the door cannot relay. */
export function inspectAnthropicMessagesRequest(raw: unknown): WireRequest {
  if (!isRecord(raw)) throw invalidBody('', 'The body must be a JSON object');
  const body = raw;
  if (typeof body.model !== 'string' || body.model.trim() === '') {
    throw invalidBody(
      'model',
      'is required — GET /api/v1/openai/models lists the models this key can call',
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw invalidBody('messages', 'must be a non-empty array');
  }
  const maxTokens = body.max_tokens;
  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1
  ) {
    throw invalidBody(
      'max_tokens',
      'is required: a whole number of at least 1',
    );
  }
  if (
    body.stream !== undefined &&
    body.stream !== null &&
    typeof body.stream !== 'boolean'
  ) {
    throw invalidBody('stream', 'must be a boolean');
  }
  for (const field of VENDOR_RUN_FIELDS) {
    if (body[field] !== undefined && body[field] !== null) {
      throw vendorToolRefusal(field);
    }
  }
  const tally: Tally = { images: 0, documents: 0, segments: [] };
  readSystem(body, tally);
  body.messages.forEach((message, index) => {
    const param = `messages.${index}`;
    if (!isRecord(message) || typeof message.role !== 'string') {
      throw invalidBody(param, 'must be a message with a "role"');
    }
    if (message.role === 'user') {
      readUserContent(message, param, tally);
    } else if (message.role !== 'assistant') {
      throw invalidBody(
        `${param}.role`,
        `"${message.role}" is not a role this endpoint relays (user, assistant)`,
      );
    }
  });
  let offersTools = false;
  if (body.tools !== undefined && body.tools !== null) {
    if (!Array.isArray(body.tools))
      throw invalidBody('tools', 'must be an array');
    body.tools.forEach((tool, index) => {
      if (!isClientTool(tool)) throw vendorToolRefusal(`tools.${index}.type`);
    });
    offersTools = body.tools.length > 0;
  }
  for (const field of GATEWAY_ONLY_FIELDS) delete body[field];
  return {
    body,
    model: body.model.trim(),
    stream: body.stream === true,
    maxOutputTokens: maxTokens,
    choiceCount: 1,
    imageCount: tally.images,
    documentCount: tally.documents,
    offersTools,
    segments: tally.segments,
  };
}

/** The body the gateway receives: the caller's, with the model the door
 * resolved. */
export function anthropicUpstreamBody(
  request: WireRequest,
  gatewayModel: string,
): Record<string, unknown> {
  return { ...request.body, model: gatewayModel };
}
