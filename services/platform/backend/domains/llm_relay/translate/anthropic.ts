import {
  isJSONObject,
  type JSONSchema7,
  type LanguageModelV4CallOptions,
  type LanguageModelV4FilePart,
  type LanguageModelV4FinishReason,
  type LanguageModelV4FunctionTool,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4Message,
  type LanguageModelV4Prompt,
  type LanguageModelV4ReasoningPart,
  type LanguageModelV4StreamPart,
  type LanguageModelV4TextPart,
  type LanguageModelV4ToolCallPart,
  type LanguageModelV4ToolChoice,
  type LanguageModelV4ToolResultOutput,
  type LanguageModelV4ToolResultPart,
  type LanguageModelV4Usage,
} from '@ai-sdk/provider';

import {
  isRecord,
  narrowStringUnion,
} from '../../../../lib/utils/type-utils.ts';
import { errorBody, type RelayErrorKind } from '../wires.ts';
import {
  type CarriedOptions,
  carriedOptions,
  mergeCarried,
  providerOptionsOf,
  seal,
  unseal,
} from './carry.ts';
import {
  type EncodeContext,
  type InboundAdapter,
  type ParsedRequest,
  TranslationError,
} from './contract.ts';
import { relayUsageOf } from './upstream.ts';

/**
 * The Anthropic Messages wire, spoken by a client whose call goes to an
 * upstream on another wire (tale-project/tale#4942): Claude Code, Tale's
 * vision tools and the platform's Anthropic-compatible endpoint, sent to a
 * model behind a Chat Completions connector. A call between two Anthropic
 * ends never comes here: it is passed through (`passthrough.ts`).
 *
 * What only Anthropic has (its server tools, its own thinking signatures, its
 * cache hints, the files uploaded to it) has nowhere to go: what the model
 * can do without is left out, named in one warning per request (cache
 * hints, which every Claude Code request carries, unnamed); what the answer
 * would be wrong without is refused, with the reason.
 *
 * A thinking block's `signature`, which the client sends back as it got it,
 * carries what the upstream asks to have back (`carry.ts`): with the
 * thinking, and with the tool calls that follow it — a Gemini model signs
 * its calls, and refuses a turn that loses the signature.
 */

type Effort = NonNullable<LanguageModelV4CallOptions['reasoning']>;

type UserPart = LanguageModelV4TextPart | LanguageModelV4FilePart;

type AssistantPart =
  | LanguageModelV4TextPart
  | LanguageModelV4ReasoningPart
  | LanguageModelV4ToolCallPart;

/** A content block: an object with a type. */
type Block = Record<string, unknown> & { type: string };

/** What reading one request collects on the way. */
interface Reading {
  /** Each tool call's name by its id: the SDK's tool result names the tool
   * it answers, where Anthropic's names only the call. */
  toolNames: Map<string, string>;
  /** What was left out, for the request's one warning. */
  dropped: Set<string>;
}

/** Blocks of one text are joined with a blank line, which keeps them apart
 * as the model would have read them. */
const BLOCK_SEPARATOR = '\n\n';

/** The efforts a client may name (`output_config.effort`): Anthropic's
 * low/medium/high/max, and the SDK's other steps, should Anthropic add them. */
const EFFORTS: readonly Effort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Request fields with no place upstream that change what the model does:
 * named in the warning. `metadata`, `service_tier` and `container` (which
 * only Anthropic's code execution reads) change nothing and go unnamed. */
const BEHAVIOUR_FIELDS = ['mcp_servers', 'context_management'] as const;

function isBlock(value: unknown): value is Block {
  return isRecord(value) && typeof value.type === 'string';
}

/** A tool's input schema as the client wrote it: an object, which the
 * upstream judges. */
function isSchema(value: unknown): value is JSONSchema7 {
  return isRecord(value);
}

/** A string field a block must have. */
function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new TranslationError(`${path}.${key} must be a string.`);
  }
  return value;
}

/** An optional number field (JSON's null reads as unset). */
function numberOf(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TranslationError(`${key} must be a number.`);
  }
  return value;
}

function urlOf(raw: unknown, path: string): URL {
  if (typeof raw !== 'string' || !URL.canParse(raw)) {
    throw new TranslationError(`${path} must be a URL.`);
  }
  return new URL(raw);
}

/** A message's content as blocks: a string is one text block. */
function blocksOf(content: unknown, path: string): Block[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) {
    throw new TranslationError(
      `${path} must be a string or a list of content blocks.`,
    );
  }
  const items: unknown[] = content;
  return items.map((item, index) => {
    if (!isBlock(item)) {
      throw new TranslationError(
        `${path}.${index} must be a content block: an object with a type.`,
      );
    }
    return item;
  });
}

/** A block of one of Anthropic's server tools (web search, web fetch, code
 * execution, the MCP connector, …): Anthropic ran the tool, and no other
 * provider can read the call or its result. */
function isServerToolBlock(type: string): boolean {
  return (
    type === 'server_tool_use' ||
    type === 'mcp_tool_use' ||
    type === 'mcp_tool_result' ||
    type === 'container_upload' ||
    type.endsWith('_tool_result')
  );
}

/** The system prompt: a string, or text blocks joined (their cache hints
 * mean nothing upstream). */
function systemOf(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) {
    throw new TranslationError(
      'system must be a string or a list of text blocks.',
    );
  }
  const blocks: unknown[] = raw;
  return blocks
    .map((block, index) => {
      if (!isBlock(block) || block.type !== 'text') {
        throw new TranslationError(`system.${index} must be a text block.`);
      }
      return requiredString(block, 'text', `system.${index}`);
    })
    .filter((text) => text !== '')
    .join(BLOCK_SEPARATOR);
}

function sourceOf(block: Block, path: string): Block {
  if (!isBlock(block.source)) {
    throw new TranslationError(`${path}.source must be an object with a type.`);
  }
  return block.source;
}

/** The refusal of a source no other provider can read. */
function unreadableSource(source: Block, path: string): TranslationError {
  return source.type === 'file'
    ? new TranslationError(
        `${path}: a file uploaded to Anthropic (file_id) cannot be read by this model; send its content as base64 data or a URL instead.`,
      )
    : new TranslationError(
        `${path}.source.type "${source.type}" is not a source the relay can read.`,
      );
}

/** An image: base64 data with its media type, or a URL (whose exact type
 * the upstream learns from what it fetches). */
function imageOf(block: Block, path: string): LanguageModelV4FilePart {
  const source = sourceOf(block, path);
  const at = `${path}.source`;
  switch (source.type) {
    case 'base64':
      return {
        type: 'file',
        mediaType: requiredString(source, 'media_type', at),
        data: { type: 'data', data: requiredString(source, 'data', at) },
      };
    case 'url':
      return {
        type: 'file',
        mediaType: 'image',
        data: { type: 'url', url: urlOf(source.url, `${at}.url`) },
      };
    default:
      throw unreadableSource(source, path);
  }
}

/** A document: a PDF (base64 or a URL) as a file, plain text as text, and
 * a content source as the blocks it holds. Citations, which the model could
 * only give on Anthropic, are left out. */
function documentOf(block: Block, path: string, reading: Reading): UserPart[] {
  const source = sourceOf(block, path);
  if (isRecord(block.citations) && block.citations.enabled === true) {
    reading.dropped.add('document citations');
  }
  const at = `${path}.source`;
  switch (source.type) {
    case 'base64':
      // Anthropic reads base64 documents as PDFs only.
      return [
        {
          type: 'file',
          mediaType:
            typeof source.media_type === 'string'
              ? source.media_type
              : 'application/pdf',
          data: { type: 'data', data: requiredString(source, 'data', at) },
        },
      ];
    case 'text':
      return [{ type: 'text', text: requiredString(source, 'data', at) }];
    case 'url':
      return [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: { type: 'url', url: urlOf(source.url, `${at}.url`) },
        },
      ];
    case 'content':
      return blocksOf(source.content, `${at}.content`).flatMap((inner, index) =>
        userContentOf(inner, `${at}.content.${index}`, reading),
      );
    default:
      throw unreadableSource(source, path);
  }
}

/** A search result as the text it carries: its title and source, then its
 * passages (the citations it allows exist only on Anthropic). */
function searchResultText(block: Block, path: string): string {
  const title = requiredString(block, 'title', path);
  const source = requiredString(block, 'source', path);
  const passages = blocksOf(block.content, `${path}.content`).map(
    (inner, index) => requiredString(inner, 'text', `${path}.content.${index}`),
  );
  return [`${title} (${source})`, ...passages].join(BLOCK_SEPARATOR);
}

/** The parts a block of user content reads as. */
function userContentOf(
  block: Block,
  path: string,
  reading: Reading,
): UserPart[] {
  switch (block.type) {
    case 'text':
      return [{ type: 'text', text: requiredString(block, 'text', path) }];
    case 'image':
      return [imageOf(block, path)];
    case 'document':
      return documentOf(block, path, reading);
    case 'search_result':
      return [{ type: 'text', text: searchResultText(block, path) }];
    default:
      if (isServerToolBlock(block.type)) {
        reading.dropped.add(`${block.type} blocks`);
        return [];
      }
      throw new TranslationError(
        `${path}: the relay cannot carry a block of type "${block.type}" to this model.`,
      );
  }
}

/**
 * A tool result: text answers the call as text (`is_error` as error text).
 * One with an image or a document answers it as the SDK's content, its text
 * and files in their order; the relay moves the files where the upstream's
 * wire can take them (`promptForUpstream`). Content has no error flag: what
 * failed is in its text.
 */
function toolResultOf(
  block: Block,
  path: string,
  reading: Reading,
): LanguageModelV4ToolResultPart {
  const id = requiredString(block, 'tool_use_id', path);
  const name = reading.toolNames.get(id);
  if (name === undefined) {
    throw new TranslationError(
      `${path}.tool_use_id "${id}" answers no tool_use of an earlier assistant message.`,
    );
  }
  const parts: UserPart[] = [];
  const content =
    block.content == null ? [] : blocksOf(block.content, `${path}.content`);
  for (const [index, inner] of content.entries()) {
    if (inner.type === 'tool_reference') {
      // It loads a deferred tool's definition on Anthropic; every tool is
      // given to this model from the start.
      reading.dropped.add('tool_reference blocks');
      continue;
    }
    parts.push(...userContentOf(inner, `${path}.content.${index}`, reading));
  }
  let output: LanguageModelV4ToolResultOutput;
  if (parts.some((part) => part.type === 'file')) {
    output = { type: 'content', value: parts };
  } else {
    const value = parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join(BLOCK_SEPARATOR);
    output =
      block.is_error === true
        ? { type: 'error-text', value }
        : { type: 'text', value };
  }
  return { type: 'tool-result', toolCallId: id, toolName: name, output };
}

/** A user message as the SDK takes it: the tool results it carries first,
 * as a tool message, then the rest as a user message. */
function userMessages(
  blocks: readonly Block[],
  path: string,
  reading: Reading,
): LanguageModelV4Message[] {
  const results: LanguageModelV4ToolResultPart[] = [];
  const parts: UserPart[] = [];
  for (const [index, block] of blocks.entries()) {
    const at = `${path}.content.${index}`;
    switch (block.type) {
      case 'tool_result':
        results.push(toolResultOf(block, at, reading));
        break;
      case 'tool_use':
      case 'thinking':
      case 'redacted_thinking':
        throw new TranslationError(
          `${at}: a block of type "${block.type}" belongs in an assistant message.`,
        );
      default:
        parts.push(...userContentOf(block, at, reading));
    }
  }
  const messages: LanguageModelV4Message[] = [];
  if (results.length > 0) messages.push({ role: 'tool', content: results });
  if (parts.length > 0) messages.push({ role: 'user', content: parts });
  return messages;
}

/** An assistant message: its text, its thinking and its tool calls. */
function assistantMessage(
  blocks: readonly Block[],
  path: string,
  reading: Reading,
): LanguageModelV4Message | undefined {
  const parts: AssistantPart[] = [];
  // What the relay's signatures carried for the calls after them, by id.
  const carriedCalls = new Map<string, CarriedOptions>();
  for (const [index, block] of blocks.entries()) {
    const at = `${path}.content.${index}`;
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: requiredString(block, 'text', at) });
        break;
      case 'thinking': {
        const thinking = requiredString(block, 'thinking', at);
        // A signature the relay sealed brings back what the upstream asked
        // for with this thinking and the calls after it, and the text its
        // own fields hold for. Any other (Anthropic's own) means nothing to
        // another provider: only the text goes.
        const carried = unseal(block.signature);
        for (const [id, options] of Object.entries(carried?.calls ?? {})) {
          carriedCalls.set(id, options);
        }
        const providerOptions = providerOptionsOf(carried);
        const text = carried?.text ?? thinking;
        // An empty block that carried only calls is no thinking.
        if (text !== '' || providerOptions !== undefined) {
          parts.push({
            type: 'reasoning',
            text,
            ...(providerOptions !== undefined ? { providerOptions } : {}),
          });
        }
        break;
      }
      case 'redacted_thinking':
        reading.dropped.add('redacted_thinking blocks');
        break;
      case 'tool_use': {
        const id = requiredString(block, 'id', at);
        const name = requiredString(block, 'name', at);
        reading.toolNames.set(id, name);
        const providerOptions = carriedCalls.get(id);
        parts.push({
          type: 'tool-call',
          toolCallId: id,
          toolName: name,
          input: block.input ?? {},
          ...(providerOptions !== undefined ? { providerOptions } : {}),
        });
        break;
      }
      default:
        if (isServerToolBlock(block.type)) {
          reading.dropped.add(`${block.type} blocks`);
          break;
        }
        throw new TranslationError(
          `${at}: an assistant message cannot carry a block of type "${block.type}" to this model.`,
        );
    }
  }
  return parts.length > 0 ? { role: 'assistant', content: parts } : undefined;
}

function promptOf(
  system: string,
  messages: readonly unknown[],
  reading: Reading,
): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt =
    system === '' ? [] : [{ role: 'system', content: system }];
  for (const [index, message] of messages.entries()) {
    const path = `messages.${index}`;
    if (!isRecord(message)) {
      throw new TranslationError(
        `${path} must be a message: an object with a role and content.`,
      );
    }
    const blocks = blocksOf(message.content, `${path}.content`);
    if (message.role === 'user') {
      prompt.push(...userMessages(blocks, path, reading));
    } else if (message.role === 'assistant') {
      const assistant = assistantMessage(blocks, path, reading);
      if (assistant !== undefined) prompt.push(assistant);
    } else {
      throw new TranslationError(`${path}.role must be "user" or "assistant".`);
    }
  }
  return prompt;
}

/** A tool's input schema. A tool without one, or an object schema without
 * properties, gets an empty property list: some upstreams refuse a schema
 * without one. */
function schemaOf(raw: unknown, path: string): JSONSchema7 {
  if (raw == null) return { type: 'object', properties: {} };
  if (!isSchema(raw)) {
    throw new TranslationError(`${path} must be a JSON Schema object.`);
  }
  if (Object.keys(raw).length === 0) return { type: 'object', properties: {} };
  return raw.type === 'object' && raw.properties === undefined
    ? { ...raw, properties: {} }
    : raw;
}

/** The client's own tools, as function tools. Anthropic's server tools
 * (web search, code execution, its bash, text editor and computer tools)
 * exist only there, and are left out. */
function toolsOf(
  raw: unknown,
  reading: Reading,
): LanguageModelV4FunctionTool[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new TranslationError('tools must be a list of tools.');
  }
  const items: unknown[] = raw;
  const tools: LanguageModelV4FunctionTool[] = [];
  for (const [index, tool] of items.entries()) {
    const path = `tools.${index}`;
    if (!isRecord(tool)) throw new TranslationError(`${path} must be a tool.`);
    if (tool.type != null && tool.type !== 'custom') {
      if (typeof tool.type !== 'string') {
        throw new TranslationError(`${path}.type must be a string.`);
      }
      reading.dropped.add(`the ${tool.type} tool`);
      continue;
    }
    const examples: unknown[] = Array.isArray(tool.input_examples)
      ? tool.input_examples
      : [];
    const inputExamples = examples
      .filter(isJSONObject)
      .map((input) => ({ input }));
    tools.push({
      type: 'function',
      name: requiredString(tool, 'name', path),
      ...(typeof tool.description === 'string'
        ? { description: tool.description }
        : {}),
      inputSchema: schemaOf(tool.input_schema, `${path}.input_schema`),
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
      ...(inputExamples.length > 0 ? { inputExamples } : {}),
    });
  }
  return tools;
}

/** The tool choice: auto, any (a call is required), one tool by name, or
 * none. A tool it names must be among those the model is given. */
function toolChoiceOf(
  raw: unknown,
  tools: readonly LanguageModelV4FunctionTool[],
  reading: Reading,
): LanguageModelV4ToolChoice | undefined {
  if (raw == null) return undefined;
  if (!isRecord(raw)) {
    throw new TranslationError('tool_choice must be an object.');
  }
  if (raw.disable_parallel_tool_use === true) {
    reading.dropped.add('disable_parallel_tool_use');
  }
  switch (raw.type) {
    case 'auto':
      return { type: 'auto' };
    case 'any':
      return { type: 'required' };
    case 'none':
      return { type: 'none' };
    case 'tool': {
      const name = requiredString(raw, 'name', 'tool_choice');
      if (!tools.some((tool) => tool.name === name)) {
        throw new TranslationError(
          `tool_choice names the tool ${name}, which is not among the tools this model can be given.`,
        );
      }
      return { type: 'tool', toolName: name };
    }
    default:
      throw new TranslationError(
        'tool_choice.type must be "auto", "any", "tool" or "none".',
      );
  }
}

/** The nearest effort to a thinking budget. */
function effortOfBudget(budget: number): Effort {
  if (budget <= 2048) return 'low';
  if (budget <= 8192) return 'medium';
  return 'high';
}

/**
 * How hard the client asked the model to think, as the SDK's effort.
 * Thinking turned off is 'none', whatever else the request says; an effort
 * the client names (`output_config.effort`) is taken as named; a thinking
 * budget is read as the nearest effort; adaptive thinking leaves it to the
 * model.
 */
function reasoningOf(body: Record<string, unknown>): Effort | undefined {
  let fromBudget: Effort | undefined;
  const thinking = body.thinking;
  if (thinking != null) {
    if (!isRecord(thinking)) {
      throw new TranslationError('thinking must be an object.');
    }
    switch (thinking.type) {
      case 'disabled':
        return 'none';
      case 'enabled':
        if (typeof thinking.budget_tokens !== 'number') {
          throw new TranslationError(
            'thinking.budget_tokens must be a number when thinking is enabled.',
          );
        }
        fromBudget = effortOfBudget(thinking.budget_tokens);
        break;
      case 'adaptive':
        break;
      default:
        throw new TranslationError(
          'thinking.type must be "enabled", "disabled" or "adaptive".',
        );
    }
  }
  const config = body.output_config;
  if (isRecord(config) && config.effort != null) {
    const effort =
      typeof config.effort === 'string'
        ? narrowStringUnion(config.effort, EFFORTS)
        : undefined;
    if (effort === undefined) {
      throw new TranslationError(
        'output_config.effort must be "low", "medium", "high" or "max".',
      );
    }
    return effort;
  }
  return fromBudget;
}

/** A structured answer the client asked for (`output_config.format`, or the
 * beta's `output_format`): JSON that matches a schema. */
function responseFormatOf(
  body: Record<string, unknown>,
): LanguageModelV4CallOptions['responseFormat'] {
  const config = body.output_config;
  if (config != null && !isRecord(config)) {
    throw new TranslationError('output_config must be an object.');
  }
  const format = config?.format ?? body.output_format;
  if (format == null) return undefined;
  if (!isRecord(format) || format.type !== 'json_schema') {
    throw new TranslationError(
      'output_config.format must be {"type": "json_schema", "schema": {…}}.',
    );
  }
  if (!isSchema(format.schema)) {
    throw new TranslationError(
      'output_config.format.schema must be a JSON Schema object.',
    );
  }
  return { type: 'json', schema: format.schema };
}

function stopSequencesOf(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  const items: unknown[] = Array.isArray(raw) ? raw : [];
  const sequences = items.filter(
    (item): item is string => typeof item === 'string',
  );
  if (!Array.isArray(raw) || sequences.length !== items.length) {
    throw new TranslationError('stop_sequences must be a list of strings.');
  }
  return sequences.length > 0 ? sequences : undefined;
}

/** One warning for what a request or an answer left out. */
function warnDropped(what: string, dropped: ReadonlySet<string>): void {
  if (dropped.size === 0) return;
  console.warn(
    `[llm-relay] ${what} left out what the other wire has no place for: ${[...dropped].join(', ')}`,
  );
}

function parseRequest(body: Record<string, unknown>): ParsedRequest {
  const maxOutputTokens = body.max_tokens;
  if (
    typeof maxOutputTokens !== 'number' ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  ) {
    throw new TranslationError(
      'max_tokens is required: the most tokens the answer may take, a whole number of at least 1.',
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new TranslationError(
      'messages is required: a list of user and assistant messages, at least one.',
    );
  }
  const messages: unknown[] = body.messages;
  const reading: Reading = { toolNames: new Map(), dropped: new Set() };
  const options: ParsedRequest['options'] = {
    prompt: promptOf(systemOf(body.system), messages, reading),
    maxOutputTokens,
  };

  const tools = toolsOf(body.tools, reading);
  const toolChoice = toolChoiceOf(body.tool_choice, tools, reading);
  if (tools.length > 0) {
    options.tools = tools;
    if (toolChoice !== undefined) options.toolChoice = toolChoice;
  } else if (toolChoice?.type === 'required') {
    throw new TranslationError(
      'tool_choice asks for a tool call, but the request has no tool this model can be given.',
    );
  }

  const temperature = numberOf(body, 'temperature');
  if (temperature !== undefined) options.temperature = temperature;
  const topP = numberOf(body, 'top_p');
  if (topP !== undefined) options.topP = topP;
  const topK = numberOf(body, 'top_k');
  if (topK !== undefined) options.topK = topK;
  const stopSequences = stopSequencesOf(body.stop_sequences);
  if (stopSequences !== undefined) options.stopSequences = stopSequences;
  const reasoning = reasoningOf(body);
  if (reasoning !== undefined) options.reasoning = reasoning;
  const responseFormat = responseFormatOf(body);
  if (responseFormat !== undefined) options.responseFormat = responseFormat;

  for (const field of BEHAVIOUR_FIELDS) {
    if (body[field] != null) reading.dropped.add(field);
  }
  warnDropped('an Anthropic request', reading.dropped);
  return { options };
}

/** One server-sent event the way Anthropic writes it: its type on the
 * `event:` line and again in the data. */
function sse(type: string, data: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/** The SDK's usage in Anthropic's terms: input without the cache, cache
 * writes and reads, and every output token, thinking included. */
function usageOf(usage: LanguageModelV4Usage): Record<string, number> {
  const relay = relayUsageOf(usage);
  return {
    input_tokens: relay.inputTokens,
    cache_creation_input_tokens: relay.cacheWriteTokens,
    cache_read_input_tokens: relay.cacheReadTokens,
    output_tokens: relay.outputTokens,
  };
}

/** Anthropic's stop reason. A message that called a tool stops for tool use,
 * as Anthropic's always does: some upstreams say `stop` with a call. */
function stopReasonOf(
  finish: LanguageModelV4FinishReason,
  calledTool: boolean,
): string {
  switch (finish.unified) {
    case 'length':
      return 'max_tokens';
    case 'content-filter':
      return 'refusal';
    case 'stop':
    case 'tool-calls':
    case 'error':
    case 'interrupted':
    case 'other':
      return calledTool ? 'tool_use' : 'end_turn';
    default: {
      const _exhaustive: never = finish.unified;
      return _exhaustive;
    }
  }
}

/** A tool call's input as the object Anthropic's tool_use carries. */
function toolInputOf(json: string): Record<string, unknown> {
  if (json.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(json);
    if (isRecord(value)) return value;
    console.warn(
      '[llm-relay] a tool call input is JSON but no object; answered as {}',
    );
  } catch (error) {
    console.warn(
      `[llm-relay] a tool call input is not JSON (${error instanceof Error ? error.message : String(error)}); answered as {}`,
    );
  }
  return {};
}

/** What a thinking block's signature carries, gathered as the block is
 * written: what the provider asked to have back with the thinking, the
 * text that holds for, and what it asked for with each call after it. */
interface ThinkingDraft {
  text: string;
  options?: CarriedOptions;
  calls: Record<string, CarriedOptions>;
}

/** A thinking block's signature, or undefined when it carries nothing. The
 * text goes only with the provider's own fields, which hold for it. */
function signatureOf(draft: ThinkingDraft): string | undefined {
  return seal({
    ...(draft.options !== undefined
      ? { options: draft.options, text: draft.text }
      : {}),
    calls: draft.calls,
  });
}

/** A thinking block as it starts: its text comes in deltas, and its
 * signature, when it carries something, in one delta before its stop. */
const THINKING_START = { type: 'thinking', thinking: '', signature: '' };

interface OpenBlock {
  index: number;
  /** The SDK's stream the block holds: `text:<id>` or `thinking:<id>`. */
  key: string;
  /** Its stream ended. A thinking block stays open past its end, so that
   * the calls right after it are carried by its signature. */
  ended: boolean;
  /** What a thinking block's signature will carry. */
  thinking?: ThinkingDraft;
}

/** A tool call held back until it is whole: only its tool-call part says
 * what the provider asks to have back with it, which goes before it. */
interface HeldCall {
  id: string;
  name: string;
  /** Its input as streamed, until the tool-call part gives it whole. */
  input: string;
  /** Its deltas are JSON; raw text comes whole with the tool-call part. */
  json: boolean;
  /** Its tool-call part came. */
  whole: boolean;
  options?: CarriedOptions;
}

function toolUseBlock(call: HeldCall): Record<string, unknown> {
  return { type: 'tool_use', id: call.id, name: call.name, input: {} };
}

/** The parts that write content blocks. */
type BlockPart = Extract<
  LanguageModelV4StreamPart,
  {
    type:
      | 'text-start'
      | 'text-delta'
      | 'text-end'
      | 'reasoning-start'
      | 'reasoning-delta'
      | 'reasoning-end'
      | 'tool-input-start'
      | 'tool-input-delta'
      | 'tool-input-end'
      | 'tool-call';
  }
>;

/** The parts of a text or a thinking block. */
type ProsePart = Extract<
  BlockPart,
  {
    type:
      | 'text-start'
      | 'text-delta'
      | 'text-end'
      | 'reasoning-start'
      | 'reasoning-delta'
      | 'reasoning-end';
  }
>;

/**
 * The content blocks of one streamed message, in the order Anthropic writes
 * them: one block open at a time, started, filled and stopped before the
 * next begins, indexes counting from 0. Text and thinking stream as they
 * come; the SDK's parts may overlap (a text left open while tool calls
 * stream, an id used again after its end), so a part for another block
 * stops the open one.
 *
 * A tool call is held back until it is whole, since only its tool-call part
 * (which a Chat Completions upstream's SDK gives when the stream ends) says
 * what the provider asks to have back with it, and that goes before the
 * call: in the signature of the thinking block right before it, which stays
 * open for this, or in an empty thinking block written to carry it. The
 * call is then written in one piece, and what came after it waits for it.
 */
class MessageBlocks {
  /** A tool_use block was written: the message stops for tool use. */
  calledTool = false;
  private next = 0;
  private open: OpenBlock | undefined;
  private held: HeldCall[] = [];
  /** Calls written, or run by the provider itself: anything more of them
   * is ignored. */
  private readonly settled = new Set<string>();
  /** What a reasoning-start asked to have back, for the block its text
   * opens. */
  private readonly started = new Map<string, CarriedOptions>();
  private waiting: BlockPart[] = [];

  /** The events a part writes, and those of the parts it lets through. */
  take(part: BlockPart): string[] {
    switch (part.type) {
      case 'tool-input-start': {
        // A call the provider runs itself is none of the client's.
        if (part.providerExecuted === true) {
          this.settled.add(part.id);
          return [];
        }
        if (this.settled.has(part.id) || this.heldCall(part.id)) return [];
        if (this.waiting.length > 0) return this.wait(part);
        return this.hold({
          id: part.id,
          name: part.toolName,
          input: '',
          json: part.inputEncoding !== 'text',
          whole: false,
        });
      }
      case 'tool-input-delta':
      case 'tool-input-end': {
        const call = this.heldCall(part.id);
        if (call === undefined) {
          // It may be of a call whose start waits.
          return this.waiting.length > 0 ? this.wait(part) : [];
        }
        if (part.type === 'tool-input-delta' && call.json) {
          call.input += part.delta;
        }
        return [];
      }
      case 'tool-call': {
        if (part.providerExecuted === true) {
          this.settled.add(part.toolCallId);
          return [];
        }
        if (this.settled.has(part.toolCallId)) return [];
        const options = carriedOptions(part.providerMetadata);
        const call = this.heldCall(part.toolCallId);
        let events: string[] = [];
        if (call !== undefined) {
          call.input = part.input;
          call.whole = true;
          if (options !== undefined) call.options = options;
        } else if (this.waiting.length > 0) {
          return this.wait(part);
        } else {
          // A call given whole.
          events = this.hold({
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
            json: true,
            whole: true,
            ...(options !== undefined ? { options } : {}),
          });
        }
        if (this.held.some((held) => !held.whole)) return events;
        return [...events, ...this.writeCalls(), ...this.release()];
      }
      default:
        // Text and thinking after held calls wait for them.
        if (this.held.length > 0 || this.waiting.length > 0) {
          return this.wait(part);
        }
        return this.write(part);
    }
  }

  /** Calls are held, or parts wait behind them: the client hears nothing of
   * what the model writes meanwhile. */
  holding(): boolean {
    return this.held.length > 0 || this.waiting.length > 0;
  }

  /** The events that end the message's content: held calls written as
   * they stand, what waited written after them, the open block stopped. */
  finish(): string[] {
    const events: string[] = [];
    while (this.held.length > 0 || this.waiting.length > 0) {
      events.push(...this.writeCalls(), ...this.release());
    }
    events.push(...this.stop());
    return events;
  }

  private heldCall(id: string): HeldCall | undefined {
    return this.held.find((call) => call.id === id);
  }

  private wait(part: BlockPart): string[] {
    this.waiting.push(part);
    return [];
  }

  private release(): string[] {
    const parts = this.waiting;
    this.waiting = [];
    return parts.flatMap((part) => this.take(part));
  }

  /** Holds a call back. A text before it is over; a thinking block before
   * it stays open, to carry it. */
  private hold(call: HeldCall): string[] {
    const events = this.open?.thinking === undefined ? this.stop() : [];
    this.held.push(call);
    return events;
  }

  /** The held calls, each written in one block, after what carries what
   * they asked to have back: the signature of the thinking block open
   * before them, or of an empty one written for it. */
  private writeCalls(): string[] {
    const calls = this.held;
    if (calls.length === 0) return [];
    this.held = [];
    const carried = Object.fromEntries(
      calls.flatMap((call): Array<[string, CarriedOptions]> =>
        call.options === undefined ? [] : [[call.id, call.options]],
      ),
    );
    const events: string[] = [];
    const thinking = this.open?.thinking;
    if (thinking !== undefined) {
      thinking.calls = { ...thinking.calls, ...carried };
    } else if (Object.keys(carried).length > 0) {
      events.push(
        ...this.ensure('carrier', THINKING_START, () => ({
          text: '',
          calls: carried,
        })).events,
      );
    }
    events.push(...this.stop());
    for (const call of calls) {
      this.settled.add(call.id);
      this.calledTool = true;
      const index = this.next;
      this.next += 1;
      events.push(
        sse('content_block_start', {
          index,
          content_block: toolUseBlock(call),
        }),
        sse('content_block_delta', {
          index,
          delta: {
            type: 'input_json_delta',
            partial_json: call.input.trim() === '' ? '{}' : call.input,
          },
        }),
        sse('content_block_stop', { index }),
      );
    }
    return events;
  }

  private write(part: ProsePart): string[] {
    switch (part.type) {
      case 'text-start':
        // A block starts with its first text, so an empty one is never
        // written.
        return [];
      case 'reasoning-start': {
        const asked = carriedOptions(part.providerMetadata);
        if (asked !== undefined) {
          this.started.set(
            part.id,
            mergeCarried(this.started.get(part.id), asked) ?? asked,
          );
        }
        return [];
      }
      case 'text-delta': {
        if (part.delta === '') return [];
        const { events, open } = this.ensure(`text:${part.id}`, {
          type: 'text',
          text: '',
        });
        events.push(this.delta(open, { type: 'text_delta', text: part.delta }));
        return events;
      }
      case 'reasoning-delta': {
        const asked = carriedOptions(part.providerMetadata);
        // A delta may bring only what the provider asks to have back.
        if (part.delta === '' && asked === undefined) return [];
        const { events, open } = this.ensure(
          `thinking:${part.id}`,
          THINKING_START,
          () => this.draft(part.id),
        );
        const thinking = open.thinking;
        if (thinking !== undefined) {
          thinking.options = mergeCarried(thinking.options, asked);
          thinking.text += part.delta;
        }
        if (part.delta !== '') {
          events.push(
            this.delta(open, { type: 'thinking_delta', thinking: part.delta }),
          );
        }
        return events;
      }
      case 'text-end':
        return this.open?.key === `text:${part.id}` ? this.stop() : [];
      case 'reasoning-end': {
        const key = `thinking:${part.id}`;
        const asked = carriedOptions(part.providerMetadata);
        const open = this.open;
        if (open?.key === key && !open.ended) {
          if (open.thinking !== undefined) {
            open.thinking.options = mergeCarried(open.thinking.options, asked);
          }
          open.ended = true;
          return [];
        }
        // Thinking without text that asks for something back (Anthropic's
        // redacted thinking) gets an empty block, to carry it.
        const draft = this.draft(part.id);
        draft.options = mergeCarried(draft.options, asked);
        if (draft.options === undefined) return [];
        const written = this.ensure(key, THINKING_START, () => draft);
        written.open.ended = true;
        return written.events;
      }
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }

  /** A new thinking block's draft, with what its stream's start asked for. */
  private draft(id: string): ThinkingDraft {
    const options = this.started.get(id);
    this.started.delete(id);
    return {
      text: '',
      calls: {},
      ...(options !== undefined ? { options } : {}),
    };
  }

  /** The block of `key`, open: started (stopping the one open before)
   * unless it is the one open and its stream has not ended. */
  private ensure(
    key: string,
    block: Record<string, unknown>,
    draft?: () => ThinkingDraft,
  ): { events: string[]; open: OpenBlock } {
    const open = this.open;
    if (open?.key === key && !open.ended) return { events: [], open };
    const events = this.stop();
    const thinking = draft?.();
    const started: OpenBlock = {
      index: this.next,
      key,
      ended: false,
      ...(thinking !== undefined ? { thinking } : {}),
    };
    this.next += 1;
    this.open = started;
    events.push(
      sse('content_block_start', {
        index: started.index,
        content_block: block,
      }),
    );
    return { events, open: started };
  }

  private delta(open: OpenBlock, delta: Record<string, unknown>): string {
    return sse('content_block_delta', { index: open.index, delta });
  }

  /** Stops the open block. A thinking block that carries something says
   * it in a signature_delta just before. */
  private stop(): string[] {
    const open = this.open;
    if (open === undefined) return [];
    this.open = undefined;
    const events: string[] = [];
    const signature =
      open.thinking === undefined ? undefined : signatureOf(open.thinking);
    if (signature !== undefined) {
      events.push(
        sse('content_block_delta', {
          index: open.index,
          delta: { type: 'signature_delta', signature },
        }),
      );
    }
    events.push(sse('content_block_stop', { index: open.index }));
    return events;
  }
}

type FinishPart = Extract<LanguageModelV4StreamPart, { type: 'finish' }>;

/** Anthropic's keep-alive event, byte for byte as its API sends it. */
const PING = 'event: ping\ndata: {"type": "ping"}\n\n';

/** How long a client may hear nothing while calls are held before the
 * stream pings it: a long Write or Edit input takes minutes to come whole,
 * and Claude Code gives up on a stream that stays silent too long. */
const KEEP_ALIVE_MS = 10_000;

let keepAliveNow: () => number = () => Date.now();

/** Sets the clock the stream's keep-alive reads, and returns what restores
 * it. A seam for the unit layer. */
export function setKeepAliveClockForTests(now: () => number): () => void {
  const previous = keepAliveNow;
  keepAliveNow = now;
  return () => {
    keepAliveNow = previous;
  };
}

/** The events a part before the finish writes. */
function eventsOfPart(
  part: Exclude<LanguageModelV4StreamPart, FinishPart>,
  blocks: MessageBlocks,
  dropped: Set<string>,
): string[] {
  switch (part.type) {
    case 'text-start':
    case 'text-delta':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'tool-input-end':
    case 'tool-call':
      return blocks.take(part);
    case 'ping':
      return [PING];
    case 'file':
      dropped.add('a file the model made');
      return [];
    case 'reasoning-file':
      dropped.add('a file the model made while thinking');
      return [];
    case 'error':
      // The relay turns an error part into a throw before it gets here; one
      // that does ends the stream the same way.
      throw part.error instanceof Error
        ? part.error
        : new Error('the model provider reported an error mid-stream');
    case 'stream-start':
    case 'response-metadata':
    case 'raw':
    case 'source':
    case 'custom':
    case 'tool-result':
    case 'tool-approval-request':
      return [];
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

/** The SDK's stream as Anthropic's: `message_start`, the content blocks,
 * then `message_delta` with the stop reason and the usage, and
 * `message_stop`. */
async function* encodeStream(
  parts: AsyncIterable<LanguageModelV4StreamPart>,
  context: EncodeContext,
): AsyncGenerator<string> {
  // The upstream reports its usage at the end: the start says none.
  yield sse('message_start', {
    message: {
      id: `msg_${context.id}`,
      type: 'message',
      role: 'assistant',
      model: context.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  let lastEvent = keepAliveNow();
  const blocks = new MessageBlocks();
  const dropped = new Set<string>();
  let finish: FinishPart | undefined;
  for await (const part of parts) {
    if (part.type === 'finish') {
      finish = part;
      break;
    }
    const events = eventsOfPart(part, blocks, dropped);
    if (events.length > 0) {
      yield* events;
      lastEvent = keepAliveNow();
    } else if (
      blocks.holding() &&
      keepAliveNow() - lastEvent >= KEEP_ALIVE_MS
    ) {
      // The model is writing a held call's input, which the client hears
      // nothing of: a ping tells it the stream is alive.
      yield PING;
      lastEvent = keepAliveNow();
    }
  }
  // The parts end with a finish part unless the upstream failed, when they
  // throw: an end without one is a stream that broke off.
  if (finish === undefined) {
    throw new Error("the model provider's stream ended before its answer did");
  }
  yield* blocks.finish();
  yield sse('message_delta', {
    delta: {
      stop_reason: stopReasonOf(finish.finishReason, blocks.calledTool),
      stop_sequence: null,
    },
    usage: usageOf(finish.usage),
  });
  yield sse('message_stop');
  warnDropped('an answer to an Anthropic client', dropped);
}

/** A whole answer as Anthropic's message. Each thinking block's signature
 * carries what the provider asked to have back with it and with the calls
 * after it; calls that ask for something with no thinking block before
 * them get an empty one, to carry it. */
function encodeAnswer(
  result: LanguageModelV4GenerateResult,
  context: EncodeContext,
): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  const dropped = new Set<string>();
  let calledTool = false;
  const thinkings: Array<{
    block: Record<string, unknown>;
    draft: ThinkingDraft;
  }> = [];
  const thinkingBlock = (draft: ThinkingDraft): ThinkingDraft => {
    const block = { type: 'thinking', thinking: draft.text, signature: '' };
    content.push(block);
    thinkings.push({ block, draft });
    return draft;
  };
  // The thinking block whose signature carries the calls after it.
  let carrier: ThinkingDraft | undefined;
  for (const part of result.content) {
    switch (part.type) {
      case 'text':
        if (part.text !== '') content.push({ type: 'text', text: part.text });
        break;
      case 'reasoning': {
        const options = carriedOptions(part.providerMetadata);
        if (part.text === '' && options === undefined) break;
        carrier = thinkingBlock({
          text: part.text,
          calls: {},
          ...(options !== undefined ? { options } : {}),
        });
        break;
      }
      case 'tool-call': {
        if (part.providerExecuted === true) break;
        calledTool = true;
        const options = carriedOptions(part.providerMetadata);
        if (options !== undefined) {
          carrier ??= thinkingBlock({ text: '', calls: {} });
          carrier.calls = { ...carrier.calls, [part.toolCallId]: options };
        }
        content.push({
          type: 'tool_use',
          id: part.toolCallId,
          name: part.toolName,
          input: toolInputOf(part.input),
        });
        break;
      }
      case 'file':
        dropped.add('a file the model made');
        break;
      case 'reasoning-file':
        dropped.add('a file the model made while thinking');
        break;
      case 'custom':
      case 'source':
      case 'tool-result':
      case 'tool-approval-request':
        break;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
  for (const { block, draft } of thinkings) {
    block.signature = signatureOf(draft) ?? '';
  }
  warnDropped('an answer to an Anthropic client', dropped);
  return {
    id: `msg_${context.id}`,
    type: 'message',
    role: 'assistant',
    model: context.model,
    content,
    stop_reason: stopReasonOf(result.finishReason, calledTool),
    stop_sequence: null,
    usage: usageOf(result.usage),
  };
}

/** Anthropic's in-stream error event, which names no answer. */
function encodeStreamError(
  kind: RelayErrorKind,
  message: string,
  _context: EncodeContext,
): string {
  return `event: error\ndata: ${JSON.stringify(errorBody('anthropic', kind, message))}\n\n`;
}

/**
 * The Anthropic Messages wire's adapter: a request read into the SDK's call
 * ({@link parseRequest}), an answer written as Anthropic's server-sent
 * events or as its message, and a stream that broke as its `error` event.
 */
export const anthropicAdapter: InboundAdapter = {
  parse: parseRequest,
  encodeStream,
  encodeAnswer,
  encodeStreamError,
};
