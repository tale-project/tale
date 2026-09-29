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
 * The OpenAI Chat Completions request as the door reads it — just the facts
 * it acts on, the rest relayed as sent: the model, whether to stream, the
 * output cap, the media and tools the request carries, and the system and
 * user text the input guardrails judge.
 *
 * The door refuses what it could not govern, naming the field:
 *  - a role outside `system`, `developer`, `user`, `assistant`, `tool`,
 *    `function`;
 *  - a user content part outside `text`, `image_url`, `file` (audio input is
 *    not served), and a system or developer part other than `text` — every
 *    word a person or a system prompt sends is text the guardrails see;
 *  - an image or file URL that is neither inline (`data:`) nor `https:`;
 *  - a tool that is not the caller's own (`function`, `custom`), and
 *    `web_search_options`: a search the vendor runs is neither metered nor
 *    audited here.
 * Assistant turns and tool results are relayed unread: they are the model's
 * own output and the caller's tool data, which the guardrails do not judge.
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

function positiveInteger(value: unknown, param: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidBody(param, 'must be a whole number of at least 1');
  }
  return value;
}

/** A text part the guardrails judge in place. */
function partSegment(
  part: Record<string, unknown>,
  role: TextSegment['role'],
): TextSegment {
  return {
    role,
    read: () => (typeof part.text === 'string' ? part.text : ''),
    write: (text) => {
      part.text = text;
    },
  };
}

/** A message whose content is one string, judged in place. */
function contentSegment(
  message: Record<string, unknown>,
  role: TextSegment['role'],
): TextSegment {
  return {
    role,
    read: () => (typeof message.content === 'string' ? message.content : ''),
    write: (text) => {
      message.content = text;
    },
  };
}

interface Tally {
  images: number;
  documents: number;
  segments: TextSegment[];
}

function readSystemContent(
  message: Record<string, unknown>,
  param: string,
  tally: Tally,
): void {
  const content = message.content;
  if (typeof content === 'string') {
    tally.segments.push(contentSegment(message, 'system'));
    return;
  }
  if (!Array.isArray(content)) {
    throw invalidBody(
      `${param}.content`,
      'must be a string or an array of text parts',
    );
  }
  content.forEach((part, index) => {
    const at = `${param}.content.${index}`;
    if (
      !isRecord(part) ||
      part.type !== 'text' ||
      typeof part.text !== 'string'
    ) {
      throw invalidBody(
        at,
        'a system or developer message takes text parts only',
      );
    }
    tally.segments.push(partSegment(part, 'system'));
  });
}

function readUserContent(
  message: Record<string, unknown>,
  param: string,
  tally: Tally,
): void {
  const content = message.content;
  if (typeof content === 'string') {
    tally.segments.push(contentSegment(message, 'user'));
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
        tally.segments.push(partSegment(part, 'user'));
        return;
      case 'image_url': {
        const url = isRecord(part.image_url) ? part.image_url.url : undefined;
        if (typeof url !== 'string' || !isRelayableMediaUrl(url)) {
          throw invalidBody(
            `${at}.image_url.url`,
            'must be a data: URL or an https: URL',
          );
        }
        tally.images += 1;
        return;
      }
      case 'file':
        if (!isRecord(part.file)) {
          throw invalidBody(`${at}.file`, 'must be an object');
        }
        tally.documents += 1;
        return;
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

function readTools(body: Record<string, unknown>): boolean {
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
      if (typeof type !== 'string' || !CLIENT_TOOL_TYPES.has(type)) {
        throw new ModelApiRefusal(
          400,
          'MODEL_API_VENDOR_TOOL_UNSUPPORTED',
          `tools.${index}.type: only your own tools ("function", "custom") are relayed — a tool the model vendor runs is neither metered nor audited here.`,
          { param: `tools.${index}.type` },
        );
      }
    });
    offers = body.tools.length > 0;
  }
  if (Array.isArray(body.functions) && body.functions.length > 0) offers = true;
  return offers;
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
  const tally: Tally = { images: 0, documents: 0, segments: [] };
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
    if (message.role === 'system' || message.role === 'developer') {
      readSystemContent(message, param, tally);
    } else if (message.role === 'user') {
      readUserContent(message, param, tally);
    }
  });
  const offersTools = readTools(body);
  for (const field of GATEWAY_ONLY_FIELDS) delete body[field];
  const maxOutputTokens = maxCompletion ?? maxTokens;
  return {
    body,
    model: body.model.trim(),
    stream: body.stream === true,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    choiceCount,
    imageCount: tally.images,
    documentCount: tally.documents,
    offersTools,
    segments: tally.segments,
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
 * resolved and, on a stream, the usage chunk requested. */
export function openAiUpstreamBody(
  request: WireRequest,
  gatewayModel: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...request.body,
    model: gatewayModel,
  };
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
