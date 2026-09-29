import { isRecord } from '../../../lib/utils/type-utils.ts';
import { TextCollector } from './segments.ts';
import {
  GATEWAY_ONLY_FIELDS,
  invalidBody,
  isRelayableMediaUrl,
  ModelApiRefusal,
  type SegmentPlace,
  type WireRequest,
} from './wire.ts';

/**
 * The Anthropic Messages request as the door reads it — the facts it acts
 * on, the rest relayed as sent: the model, whether to stream, `max_tokens`,
 * the media and tools the request carries, and every stretch of caller
 * text, which the input guardrails judge.
 *
 * The caller writes every role here, so every text is collected wherever it
 * sits: the system prompt (a string or text blocks), the person's turns and
 * the assistant's (prefill included), tool calls (their names and every
 * string in their input), tool results, documents given as text, search
 * results, and the tool definitions (names, descriptions, the input
 * schemas' descriptions). A signed reasoning block and a name are judged
 * but never rewritten: the vendor checks the signature, and a renamed tool
 * is one nobody defined.
 *
 * The door refuses what it could not govern, naming the field:
 *  - a role other than `user` and `assistant` (the system prompt is the
 *    top-level `system`, text blocks only);
 *  - a content block the door does not read — a person's turn takes
 *    `text`, `image`, `document`, `tool_result` and `search_result`, an
 *    assistant's `text`, `tool_use`, `thinking` and `redacted_thinking`;
 *  - an image or document URL source that is not `https:`, and a `file`
 *    source — a file stored in the organization's account with the vendor,
 *    which a key holder would otherwise reach by id;
 *  - a tool the model vendor runs (web search, web fetch, code execution,
 *    an MCP toolset) and the `mcp_servers` and `container` fields that feed
 *    them: neither metered nor audited here. The caller's own tools — plain
 *    ones and Anthropic's client-run `bash`, `text_editor`, `computer` and
 *    `memory` tools — are relayed;
 *  - a `service_tier` other than `auto` or `standard_only`, which the
 *    gateway would bill at a rate the catalog does not know.
 */

const CLIENT_TOOL_PREFIXES = ['bash_', 'text_editor_', 'computer_', 'memory_'];

/** The service tiers billed at the catalog's own rate. */
const PRICED_SERVICE_TIERS = new Set(['auto', 'standard_only']);

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

/** Text blocks (or a string) in `owner[key]`, collected; anything but a text
 * block refused with `onlyText`'s wording. */
function readTextBlocks(
  owner: Record<string, unknown>,
  key: string,
  param: string,
  where: SegmentPlace,
  collector: TextCollector,
  onlyText: string,
): void {
  const value = owner[key];
  if (value === undefined || value === null) return;
  if (typeof value === 'string') {
    collector.field(owner, key, where);
    return;
  }
  const at = param === '' ? key : `${param}.${key}`;
  if (!Array.isArray(value)) {
    throw invalidBody(at, 'must be a string or an array of text blocks');
  }
  value.forEach((block, index) => {
    if (
      !isRecord(block) ||
      block.type !== 'text' ||
      typeof block.text !== 'string'
    ) {
      throw invalidBody(`${at}.${index}`, onlyText);
    }
    collector.field(block, 'text', where);
  });
}

/** An image or document block's source: a URL one must be public https,
 * a vendor-stored file is refused, inline bytes are measured as media, and
 * a document's own text (`text` or `content` source) is text. */
function readMediaSource(
  block: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): 'binary' | 'text' {
  const source = block.source;
  if (!isRecord(source)) {
    throw invalidBody(`${param}.source`, 'must be an object');
  }
  switch (source.type) {
    case 'url':
      if (typeof source.url !== 'string' || !isRelayableMediaUrl(source.url)) {
        throw invalidBody(`${param}.source.url`, 'must be an https: URL');
      }
      return 'binary';
    case 'base64':
      if (typeof source.data === 'string') {
        collector.mediaChars += source.data.length;
      }
      return 'binary';
    case 'file':
      throw invalidBody(
        `${param}.source`,
        "files stored with the model vendor cannot be referenced through Tale — send the file's content inline",
      );
    case 'text':
      collector.field(source, 'data', 'document');
      return 'text';
    case 'content':
      readTextBlocks(
        source,
        'content',
        `${param}.source`,
        'document',
        collector,
        'a content document takes text blocks only',
      );
      return 'text';
    default:
      throw invalidBody(
        `${param}.source.type`,
        'must be "base64", "url", "text" or "content"',
      );
  }
}

function readImage(
  block: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  readMediaSource(block, param, collector);
  collector.images += 1;
}

function readDocument(
  block: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  if (readMediaSource(block, param, collector) === 'binary') {
    collector.documents += 1;
  }
  collector.field(block, 'title', 'document');
  collector.field(block, 'context', 'document');
}

function readSearchResult(
  block: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  collector.field(block, 'title', 'document');
  collector.field(block, 'source', 'document');
  readTextBlocks(
    block,
    'content',
    param,
    'document',
    collector,
    'a search result takes text blocks only',
  );
}

/** A tool result: a string, or text, image, document and search-result
 * blocks — every text in it collected, its media counted. */
function readToolResult(
  block: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  const content = block.content;
  if (typeof content === 'string') {
    collector.field(block, 'content', 'tool result');
    return;
  }
  if (!Array.isArray(content)) return;
  content.forEach((inner, index) => {
    if (!isRecord(inner)) return;
    const at = `${param}.content.${index}`;
    switch (inner.type) {
      case 'text':
        collector.field(inner, 'text', 'tool result');
        return;
      case 'image':
        readImage(inner, at, collector);
        return;
      case 'document':
        readDocument(inner, at, collector);
        return;
      case 'search_result':
        readSearchResult(inner, at, collector);
        return;
      default:
        throw invalidBody(
          `${at}.type`,
          `"${String(inner.type)}" is not a tool result block this endpoint relays (text, image, document, search_result)`,
        );
    }
  });
}

function readUserContent(
  message: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  const content = message.content;
  if (typeof content === 'string') {
    collector.field(message, 'content', 'message');
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
        collector.field(block, 'text', 'message');
        return;
      case 'image':
        readImage(block, at, collector);
        return;
      case 'document':
        readDocument(block, at, collector);
        return;
      case 'tool_result':
        readToolResult(block, at, collector);
        return;
      case 'search_result':
        readSearchResult(block, at, collector);
        return;
      default:
        throw invalidBody(
          `${at}.type`,
          `"${block.type}" is not a content block this endpoint relays (text, image, document, tool_result, search_result)`,
        );
    }
  });
}

/** An assistant turn — prefill included: its text, its tool calls (name
 * judged but never rewritten, every string of the input judged), and its
 * reasoning (signed by the vendor, so judged but never rewritten). */
function readAssistantContent(
  message: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  const content = message.content;
  if (typeof content === 'string') {
    collector.field(message, 'content', 'assistant turn');
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
        collector.field(block, 'text', 'assistant turn');
        return;
      case 'tool_use':
        collector.field(block, 'name', 'tool call', false);
        collector.leaves(block.input, 'tool call');
        return;
      case 'thinking':
        collector.field(block, 'thinking', 'assistant turn', false);
        return;
      case 'redacted_thinking':
        return;
      default:
        throw invalidBody(
          `${at}.type`,
          `"${block.type}" is not an assistant block this endpoint relays (text, tool_use, thinking, redacted_thinking)`,
        );
    }
  });
}

function readTools(
  body: Record<string, unknown>,
  collector: TextCollector,
): boolean {
  if (body.tools === undefined || body.tools === null) return false;
  if (!Array.isArray(body.tools)) {
    throw invalidBody('tools', 'must be an array');
  }
  body.tools.forEach((tool, index) => {
    if (!isRecord(tool) || !isClientTool(tool)) {
      throw vendorToolRefusal(`tools.${index}.type`);
    }
    collector.field(tool, 'name', 'tool definition', false);
    collector.field(tool, 'description', 'tool definition');
    collector.schemaText(tool.input_schema, 'tool definition');
  });
  return body.tools.length > 0;
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
  const tier = body.service_tier;
  if (
    tier !== undefined &&
    tier !== null &&
    (typeof tier !== 'string' || !PRICED_SERVICE_TIERS.has(tier))
  ) {
    throw invalidBody(
      'service_tier',
      'only "auto" and "standard_only" are served — another tier is billed at a rate this endpoint does not meter',
    );
  }
  const collector = new TextCollector();
  readTextBlocks(
    body,
    'system',
    '',
    'system prompt',
    collector,
    'the system prompt takes text blocks only',
  );
  body.messages.forEach((message, index) => {
    const param = `messages.${index}`;
    if (!isRecord(message) || typeof message.role !== 'string') {
      throw invalidBody(param, 'must be a message with a "role"');
    }
    if (message.role === 'user') {
      readUserContent(message, param, collector);
    } else if (message.role === 'assistant') {
      readAssistantContent(message, param, collector);
    } else {
      throw invalidBody(
        `${param}.role`,
        `"${message.role}" is not a role this endpoint relays (user, assistant)`,
      );
    }
  });
  const offersTools = readTools(body, collector);
  for (const field of GATEWAY_ONLY_FIELDS) delete body[field];
  return {
    body,
    model: body.model.trim(),
    stream: body.stream === true,
    maxOutputTokens: maxTokens,
    choiceCount: 1,
    imageCount: collector.images,
    documentCount: collector.documents,
    mediaChars: collector.mediaChars,
    offersTools,
    segments: collector.segments,
    textBytes: collector.textBytes,
    segmentOverflow: collector.overflow,
  };
}

/** The Anthropic betas that change what a request costs past what the
 * catalog prices: a million-token context bills the whole prompt at a
 * long-context rate once it passes 200k tokens. */
const UNPRICED_BETA_PREFIXES = ['context-1m'];

/** Refuse an `anthropic-beta` header naming a beta the gateway would bill
 * at a rate this endpoint does not meter. */
export function refuseUnpricedAnthropicBetas(header: string | undefined): void {
  if (header === undefined) return;
  const betas = header.split(',').map((beta) => beta.trim().toLowerCase());
  const unpriced = betas.find((beta) =>
    UNPRICED_BETA_PREFIXES.some((prefix) => beta.startsWith(prefix)),
  );
  if (unpriced !== undefined) {
    throw new ModelApiRefusal(
      400,
      'INVALID_HEADER',
      `anthropic-beta: "${unpriced}" is not served — its long-context rate is not metered here. Leave the beta out; requests up to the model's standard context work as usual.`,
      { param: 'anthropic-beta' },
    );
  }
}

/** The body the gateway receives: the caller's, with the model the door
 * resolved. */
export function anthropicUpstreamBody(
  request: WireRequest,
  gatewayModel: string,
): Record<string, unknown> {
  return { ...request.body, model: gatewayModel };
}
