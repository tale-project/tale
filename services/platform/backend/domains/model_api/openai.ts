import { isRecord } from '../../../lib/utils/type-utils.ts';
import { TextCollector } from './segments.ts';
import {
  GATEWAY_ONLY_FIELDS,
  invalidBody,
  isRelayableMediaUrl,
  ModelApiRefusal,
  type WireRequest,
} from './wire.ts';

/**
 * The OpenAI Chat Completions request as the door reads it — just the facts
 * it acts on, the rest relayed as sent: the model, whether to stream, the
 * output cap and answer count, the media and tools the request carries, and
 * every stretch of caller text, which the input guardrails judge.
 *
 * The caller writes every role here, so every text is collected, whichever
 * role or field it sits in: system and developer instructions, the
 * person's turns, assistant turns (their text, refusals and tool calls —
 * names and arguments), tool and function results, the tool and function
 * definitions (names, descriptions, the parameters' descriptions), a
 * predicted output, and a response format's schema. Names are judged but
 * never rewritten (a renamed tool is one nobody defined).
 *
 * The door refuses what it could not govern, naming the field:
 *  - a role outside `system`, `developer`, `user`, `assistant`, `tool`,
 *    `function`;
 *  - a user content part outside `text`, `image_url`, `file` (audio input is
 *    not served), and a system or developer part other than `text`;
 *  - an image or file URL that is neither inline (`data:`) nor `https:`,
 *    and a `file_id` — a file stored in the organization's account with the
 *    vendor, which a key holder would otherwise reach by id;
 *  - a tool that is not the caller's own (`function`, `custom`), and
 *    `web_search_options`: a search the vendor runs is neither metered nor
 *    audited here;
 *  - what the gateway would price at a rate the catalog does not know — a
 *    `service_tier` other than `auto` or `default`, and audio output
 *    (`modalities` with `audio`, an `audio` field);
 *  - `store: true`, which keeps the conversation in the vendor's account
 *    beyond the request;
 *  - `n` above {@link MAX_CHOICES}: each answer holds the whole output cap.
 */

const ROLES = new Set([
  'system',
  'developer',
  'user',
  'assistant',
  'tool',
  'function',
]);

const CLIENT_TOOL_TYPES = new Set(['function', 'custom']);

/** The most answers one request may ask for. */
const MAX_CHOICES = 8;

/** The service tiers priced at the catalog's own rate. */
const PRICED_SERVICE_TIERS = new Set(['auto', 'default']);

function positiveInteger(value: unknown, param: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidBody(param, 'must be a whole number of at least 1');
  }
  return value;
}

/** A message's content that is a string or text parts — every text in it
 * collected; any other part refused with `onlyText`'s wording. */
function readTextContent(
  message: Record<string, unknown>,
  param: string,
  collector: TextCollector,
  where: Parameters<TextCollector['field']>[2],
  onlyText: string,
): void {
  const content = message.content;
  if (content === undefined || content === null) return;
  if (typeof content === 'string') {
    collector.field(message, 'content', where);
    return;
  }
  if (!Array.isArray(content)) {
    throw invalidBody(
      `${param}.content`,
      'must be a string or an array of parts',
    );
  }
  content.forEach((part, index) => {
    const at = `${param}.content.${index}`;
    if (!isRecord(part)) throw invalidBody(at, onlyText);
    if (part.type === 'text' && typeof part.text === 'string') {
      collector.field(part, 'text', where);
    } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
      collector.field(part, 'refusal', where);
    } else {
      throw invalidBody(at, onlyText);
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
      'must be a string or an array of content parts',
    );
  }
  content.forEach((part, index) => {
    const at = `${param}.content.${index}`;
    if (!isRecord(part) || typeof part.type !== 'string') {
      throw invalidBody(at, 'must be a content part with a "type"');
    }
    switch (part.type) {
      case 'text':
        if (typeof part.text !== 'string') {
          throw invalidBody(`${at}.text`, 'must be a string');
        }
        collector.field(part, 'text', 'message');
        return;
      case 'image_url': {
        const url = isRecord(part.image_url) ? part.image_url.url : undefined;
        if (typeof url !== 'string' || !isRelayableMediaUrl(url)) {
          throw invalidBody(
            `${at}.image_url.url`,
            'must be a data: URL or an https: URL',
          );
        }
        if (url.startsWith('data:')) collector.mediaChars += url.length;
        collector.images += 1;
        return;
      }
      case 'file': {
        const file = part.file;
        if (!isRecord(file)) {
          throw invalidBody(`${at}.file`, 'must be an object');
        }
        if (file.file_id !== undefined && file.file_id !== null) {
          throw invalidBody(
            `${at}.file.file_id`,
            "files stored with the model vendor cannot be referenced through Tale — send the file's content inline as file_data",
          );
        }
        if (typeof file.file_data === 'string') {
          collector.mediaChars += file.file_data.length;
        }
        collector.field(file, 'filename', 'document');
        collector.documents += 1;
        return;
      }
      case 'input_audio':
        throw invalidBody(at, 'audio input is not served by this endpoint');
      default:
        throw invalidBody(
          `${at}.type`,
          `"${part.type}" is not a content part this endpoint relays (text, image_url, file)`,
        );
    }
  });
}

/** An assistant turn: its text and refusal, and each tool call's name
 * (judged, never rewritten) and arguments. */
function readAssistantTurn(
  message: Record<string, unknown>,
  param: string,
  collector: TextCollector,
): void {
  readTextContent(
    message,
    param,
    collector,
    'assistant turn',
    'an assistant turn takes text and refusal parts only',
  );
  collector.field(message, 'refusal', 'assistant turn');
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    if (!isRecord(call)) continue;
    const fn = isRecord(call.function) ? call.function : undefined;
    if (fn !== undefined) {
      collector.field(fn, 'name', 'tool call', false);
      collector.jsonString(fn, 'arguments', 'tool call');
    }
    const custom = isRecord(call.custom) ? call.custom : undefined;
    if (custom !== undefined) {
      collector.field(custom, 'name', 'tool call', false);
      collector.field(custom, 'input', 'tool call');
    }
  }
  const legacy = isRecord(message.function_call)
    ? message.function_call
    : undefined;
  if (legacy !== undefined) {
    collector.field(legacy, 'name', 'tool call', false);
    collector.jsonString(legacy, 'arguments', 'tool call');
  }
}

/** A tool or function definition: its name (judged, never rewritten), its
 * description and its parameters' descriptions. */
function readDefinition(
  definition: Record<string, unknown>,
  collector: TextCollector,
): void {
  collector.field(definition, 'name', 'tool definition', false);
  collector.field(definition, 'description', 'tool definition');
  collector.schemaText(definition.parameters, 'tool definition');
}

function readTools(
  body: Record<string, unknown>,
  collector: TextCollector,
): boolean {
  if (body.web_search_options !== undefined) {
    throw new ModelApiRefusal(
      400,
      'MODEL_API_VENDOR_TOOL_UNSUPPORTED',
      'web_search_options: a web search the model vendor runs is not available through Tale — it is neither metered nor audited here. Run the search yourself and send its result as a tool result.',
      { param: 'web_search_options' },
    );
  }
  let offers = false;
  if (body.tools !== undefined && body.tools !== null) {
    if (!Array.isArray(body.tools)) {
      throw invalidBody('tools', 'must be an array');
    }
    body.tools.forEach((tool, index) => {
      const type = isRecord(tool) ? tool.type : undefined;
      if (
        !isRecord(tool) ||
        typeof type !== 'string' ||
        !CLIENT_TOOL_TYPES.has(type)
      ) {
        throw new ModelApiRefusal(
          400,
          'MODEL_API_VENDOR_TOOL_UNSUPPORTED',
          `tools.${index}.type: only your own tools ("function", "custom") are relayed — a tool the model vendor runs is neither metered nor audited here.`,
          { param: `tools.${index}.type` },
        );
      }
      const definition = isRecord(tool.function)
        ? tool.function
        : isRecord(tool.custom)
          ? tool.custom
          : undefined;
      if (definition !== undefined) readDefinition(definition, collector);
    });
    offers = body.tools.length > 0;
  }
  if (Array.isArray(body.functions)) {
    for (const definition of body.functions) {
      if (isRecord(definition)) readDefinition(definition, collector);
    }
    if (body.functions.length > 0) offers = true;
  }
  return offers;
}

/** Fields the gateway would price at a rate the catalog does not know, or
 * that keep the conversation beyond the request. */
function refuseUnpricedOptions(body: Record<string, unknown>): void {
  const tier = body.service_tier;
  if (
    tier !== undefined &&
    tier !== null &&
    (typeof tier !== 'string' || !PRICED_SERVICE_TIERS.has(tier))
  ) {
    throw invalidBody(
      'service_tier',
      'only "auto" and "default" are served — another tier is billed at a rate this endpoint does not meter',
    );
  }
  if (
    (Array.isArray(body.modalities) && body.modalities.includes('audio')) ||
    (body.audio !== undefined && body.audio !== null)
  ) {
    throw invalidBody(
      Array.isArray(body.modalities) ? 'modalities' : 'audio',
      'audio output is not served by this endpoint',
    );
  }
  if (body.store === true) {
    throw invalidBody(
      'store',
      "stored completions are not served — they would keep the conversation in the organization's vendor account beyond the request",
    );
  }
}

/** The caller text outside the messages and tools: a predicted output and a
 * response format's schema. */
function readExtras(
  body: Record<string, unknown>,
  collector: TextCollector,
): void {
  const prediction = isRecord(body.prediction) ? body.prediction : undefined;
  if (prediction !== undefined) {
    readTextContent(
      prediction,
      'prediction',
      collector,
      'prediction',
      'a prediction takes text parts only',
    );
  }
  const format = isRecord(body.response_format)
    ? body.response_format
    : undefined;
  const schema =
    format !== undefined && isRecord(format.json_schema)
      ? format.json_schema
      : undefined;
  if (schema !== undefined) {
    collector.field(schema, 'name', 'response format', false);
    collector.field(schema, 'description', 'response format');
    collector.schemaText(schema.schema, 'response format');
  }
}

/** Read a Chat Completions body. Throws a {@link ModelApiRefusal} naming
 * the first field the door cannot relay. */
export function inspectOpenAiChatRequest(raw: unknown): WireRequest {
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
  if (
    body.stream !== undefined &&
    body.stream !== null &&
    typeof body.stream !== 'boolean'
  ) {
    throw invalidBody('stream', 'must be a boolean');
  }
  if (
    body.stream_options !== undefined &&
    body.stream_options !== null &&
    !isRecord(body.stream_options)
  ) {
    throw invalidBody('stream_options', 'must be an object');
  }
  const maxCompletion = positiveInteger(
    body.max_completion_tokens,
    'max_completion_tokens',
  );
  const maxTokens = positiveInteger(body.max_tokens, 'max_tokens');
  const choiceCount = positiveInteger(body.n, 'n') ?? 1;
  if (choiceCount > MAX_CHOICES) {
    throw invalidBody(
      'n',
      `must be at most ${MAX_CHOICES} — each answer holds the whole output cap against the budgets`,
    );
  }
  refuseUnpricedOptions(body);
  const collector = new TextCollector();
  body.messages.forEach((message, index) => {
    const param = `messages.${index}`;
    if (!isRecord(message) || typeof message.role !== 'string') {
      throw invalidBody(param, 'must be a message with a "role"');
    }
    if (!ROLES.has(message.role)) {
      throw invalidBody(
        `${param}.role`,
        `"${message.role}" is not a role this endpoint relays`,
      );
    }
    collector.field(message, 'name', 'message', false);
    switch (message.role) {
      case 'system':
      case 'developer':
        readTextContent(
          message,
          param,
          collector,
          'system prompt',
          'a system or developer message takes text parts only',
        );
        return;
      case 'user':
        readUserContent(message, param, collector);
        return;
      case 'assistant':
        readAssistantTurn(message, param, collector);
        return;
      default:
        readTextContent(
          message,
          param,
          collector,
          'tool result',
          'a tool or function result takes text parts only',
        );
    }
  });
  const offersTools = readTools(body, collector);
  readExtras(body, collector);
  for (const field of GATEWAY_ONLY_FIELDS) delete body[field];
  const maxOutputTokens = maxCompletion ?? maxTokens;
  return {
    body,
    model: body.model.trim(),
    stream: body.stream === true,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    choiceCount,
    imageCount: collector.images,
    documentCount: collector.documents,
    mediaChars: collector.mediaChars,
    offersTools,
    segments: collector.segments,
    textBytes: collector.textBytes,
    segmentOverflow: collector.overflow,
  };
}

/** Whether the caller asked for the stream's closing usage chunk itself —
 * the door asks for it regardless (it books the counts) and drops it from a
 * stream that did not. */
export function openAiStreamIncludesUsage(
  body: Record<string, unknown>,
): boolean {
  return (
    isRecord(body.stream_options) && body.stream_options.include_usage === true
  );
}

/** The body the gateway receives: the caller's, with the model the door
 * resolved, the output cap the hold was sized for when the caller named
 * none (the hold is a bound only if the answer is), and, on a stream, the
 * usage chunk requested. */
export function openAiUpstreamBody(
  request: WireRequest,
  gatewayModel: string,
  heldOutputCap: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...request.body,
    model: gatewayModel,
  };
  if (request.maxOutputTokens === undefined) {
    body.max_completion_tokens = heldOutputCap;
  }
  if (request.stream) {
    body.stream_options = {
      ...(isRecord(request.body.stream_options)
        ? request.body.stream_options
        : {}),
      include_usage: true,
    };
  }
  return body;
}
